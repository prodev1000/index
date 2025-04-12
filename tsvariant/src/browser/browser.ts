import {
  BrowserContext,
  BrowserContextOptions,
  Page,
  chromium,
  CDPSession,
  Browser as PlaywrightBrowser,
  ChromiumBrowser,
} from "playwright";
import { encode } from "base64-arraybuffer";
import pino from "pino";
import path from "path";
import {
  BrowserError,
  BrowserState,
  InteractiveElement,
  InteractiveElementsData,
  TabInfo,
  URLNotAllowedError,
  Viewport,
  ViewportSchema,
} from "./models.js";
import { Detector } from "./detector.js";
import {
  combineAndFilterElements,
  putHighlightElementsOnScreenshot,
} from "./utils.js";
import { findVisibleInteractiveElementsScript } from "./findVisibleInteractiveElements.js";

const logger = pino({ name: "browser" });

/**
 * Configuration for the Browser
 */
export interface ViewportSize {
  width: number;
  height: number;
}

export interface StorageStateCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export interface StorageStateOrigin {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
}

export interface StorageState {
  cookies: StorageStateCookie[];
  origins?: StorageStateOrigin[];
}

export interface BrowserConfig {
  cdpUrl?: string;
  viewportSize?: ViewportSize;
  storageState?: StorageState;
  cvModelEndpoint?: string;
  sheetsModelEndpoint?: string;
}

/**
 * Unified Browser responsible for interacting with the browser via Playwright.
 */
export class Browser {
  private config: BrowserConfig;
  private closeContext: boolean;

  // Playwright-related attributes
  private playwright: typeof chromium;
  private playwrightBrowser: PlaywrightBrowser | null;
  private context: BrowserContext | null;

  // Page and state management
  private currentPage: Page | null;
  private _state: BrowserState | null;
  private _cdpSession: CDPSession | null;

  // CV detection-related attributes
  private detector: Detector | null;

  /**
   * Initialize the browser with the given configuration
   */
  constructor(config: BrowserConfig = {}, closeContext: boolean = true) {
    logger.debug("Initializing browser");
    this.config = {
      viewportSize: { width: 1200, height: 900 },
      ...config,
    };
    this.closeContext = closeContext;

    // Initialize properties
    this.playwrightBrowser = null;
    this.context = null;
    this.currentPage = null;
    this._state = null;
    this._cdpSession = null;
    this.detector = null;

    // Initialize state
    this._initState();

    // Set up CV detection if endpoints are provided
    if (this.config.cvModelEndpoint) {
      this.setupCVDetector(
        this.config.cvModelEndpoint,
        this.config.sheetsModelEndpoint
      );
    }
  }

  /**
   * Set up the CV detector with the browser
   */
  setupCVDetector(
    cvEndpointName: string | undefined = undefined,
    sheetsEndpointName: string | undefined = undefined
  ): Detector | null {
    if (!cvEndpointName && !this.config.cvModelEndpoint) {
      logger.debug("No CV model endpoint provided, skipping CV detector setup");
      return null;
    }

    // Use provided endpoint or fall back to config
    const cvEndpoint = cvEndpointName || this.config.cvModelEndpoint;
    const sheetsEndpoint =
      sheetsEndpointName || this.config.sheetsModelEndpoint;

    if (!cvEndpoint) return null;

    this.detector = new Detector(cvEndpoint, sheetsEndpoint || "", "us-east-1");

    return this.detector;
  }

  /**
   * Initialize browser state
   */
  private _initState(url: string = ""): void {
    this._state = new BrowserState(
      url,
      [],
      ViewportSchema.parse({}),
      null,
      null,
      {}
    );
  }

  /**
   * Initialize the browser and context
   */
  async _initBrowser(): Promise<Browser> {
    logger.debug("Initializing browser context");

    // Start playwright if needed
    if (!this.playwrightBrowser) {
      // Instead of using async_playwright().start()
      this.playwright = await chromium;

      if (this.config.cdpUrl) {
        logger.info(
          `Connecting to remote browser via CDP ${this.config.cdpUrl}`
        );
        this.playwrightBrowser = await this.playwright.connectOverCDP({
          endpointURL: this.config.cdpUrl,
        });
      } else {
        logger.info("Launching new browser instance");
        this.playwrightBrowser = await this.playwright.launch({
          headless: false,
          args: [
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-web-security",
            "--disable-site-isolation-trials",
            "--disable-features=IsolateOrigins,site-per-process",
            `--window-size=${this.config.viewportSize?.width},${this.config.viewportSize?.height}`,
          ],
        });
      }
    }

    // Create context if needed
    if (!this.context) {
      if (
        this.playwrightBrowser.contexts &&
        this.playwrightBrowser.contexts.length > 0
      ) {
        this.context = this.playwrightBrowser.contexts[0];
      } else {
        this.context = await this.playwrightBrowser.newContext({
          viewport: this.config.viewportSize,
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.102 Safari/537.36",
          javaScriptEnabled: true,
          bypassCSP: true,
          ignoreHTTPSErrors: true,
        });
      }

      // Apply anti-detection scripts
      await this._applyAntiDetectionScripts();

      this.context.on("page", this._onPageChange.bind(this));

      if (this.config.storageState && this.config.storageState.cookies) {
        await this.context.addCookies(this.config.storageState.cookies);
      }
    }

    // Create page if needed
    if (!this.currentPage) {
      if (this.context.pages && this.context.pages.length > 0) {
        this.currentPage = this.context.pages[this.context.pages.length - 1];
      } else {
        this.currentPage = await this.context.newPage();
      }
    }

    return this;
  }

  /**
   * Handle page change events
   */
  private async _onPageChange(page: Page): Promise<void> {
    logger.info(`Current page changed to ${page.url()}`);

    if (this.context) {
      this._cdpSession = await this.context.newCDPSession(page);
      this.currentPage = page;
    }
  }

  /**
   * Apply scripts to avoid detection as automation
   */
  private async _applyAntiDetectionScripts(): Promise<void> {
    if (!this.context) return;

    await this.context.addInitScript(`
      // Webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });

      // Languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US']
      });

      // Plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });

      // Chrome runtime
      window.chrome = { runtime: {} };

      // Permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
      (function () {
        const originalAttachShadow = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function attachShadow(options) {
          return originalAttachShadow.call(this, { ...options, mode: "open" });
        };
      })();
    `);
  }

  /**
   * Close the browser instance and cleanup resources
   */
  async close(): Promise<void> {
    logger.debug("Closing browser");

    try {
      // Close CDP session if exists
      this._cdpSession = null;

      // Close context
      if (this.context) {
        try {
          await this.context.close();
        } catch (e) {
          logger.debug(`Failed to close context: ${e}`);
        }
        this.context = null;
      }

      // Close browser
      if (this.playwrightBrowser) {
        try {
          await this.playwrightBrowser.close();
        } catch (e) {
          logger.debug(`Failed to close browser: ${e}`);
        }
        this.playwrightBrowser = null;
      }
    } catch (e) {
      logger.error(`Error during browser cleanup: ${e}`);
    } finally {
      this.context = null;
      this.currentPage = null;
      this._state = null;
      this.playwrightBrowser = null;
    }
  }

  /**
   * Navigate to a URL
   */
  async navigateTo(url: string): Promise<void> {
    const page = await this.getCurrentPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }

  /**
   * Refresh the current page
   */
  async refreshPage(): Promise<void> {
    const page = await this.getCurrentPage();
    await page.reload();
    await page.waitForLoadState();
  }

  /**
   * Navigate forward in history
   */
  async goForward(): Promise<void> {
    const page = await this.getCurrentPage();

    try {
      await page.goForward({ timeout: 10000, waitUntil: "domcontentloaded" });
    } catch (e) {
      logger.debug(`During go_forward: ${e}`);
    }
  }

  /**
   * Get information about all tabs
   */
  async getTabsInfo(): Promise<TabInfo[]> {
    if (!this.context) {
      await this._initBrowser();
    }

    if (!this.context) {
      throw new Error("Browser context not initialized");
    }

    const tabsInfo: TabInfo[] = [];

    for (let pageId = 0; pageId < this.context.pages.length; pageId++) {
      const page = this.context.pages[pageId];
      const tabInfo: TabInfo = {
        pageId,
        url: page.url(),
        title: await page.title(),
      };

      tabsInfo.push(tabInfo);
    }

    return tabsInfo;
  }

  /**
   * Switch to a specific tab by its page_id
   */
  async switchToTab(pageId: number): Promise<void> {
    if (!this.context) {
      await this._initBrowser();
    }

    if (!this.context) {
      throw new Error("Browser context not initialized");
    }

    const pages = this.context.pages;

    if (pageId >= pages.length) {
      throw new BrowserError(`No tab found with page_id: ${pageId}`);
    }

    const page = pages[pageId];
    this.currentPage = page;

    await page.bringToFront();
    await page.waitForLoadState();
  }

  /**
   * Create a new tab and optionally navigate to a URL
   */
  async createNewTab(url?: string): Promise<void> {
    if (!this.context) {
      await this._initBrowser();
    }

    if (!this.context) {
      throw new Error("Browser context not initialized");
    }

    const newPage = await this.context.newPage();
    this.currentPage = newPage;

    await newPage.waitForLoadState();

    if (url) {
      await newPage.goto(url, { waitUntil: "domcontentloaded" });
    }
  }

  /**
   * Close the current tab
   */
  async closeCurrentTab(): Promise<void> {
    if (!this.currentPage) {
      return;
    }

    await this.currentPage.close();

    // Switch to the first available tab if any exist
    if (this.context && this.context.pages && this.context.pages.length > 0) {
      await this.switchToTab(0);
    }
  }

  /**
   * Get the current page
   */
  async getCurrentPage(): Promise<Page> {
    if (!this.currentPage) {
      await this._initBrowser();
    }

    if (!this.currentPage) {
      throw new Error("Failed to initialize page");
    }

    return this.currentPage;
  }

  /**
   * Get the current browser state
   */
  getState(): BrowserState {
    if (!this._state) {
      throw new Error("Browser state not initialized");
    }

    return this._state;
  }

  /**
   * Update the browser state with current page information and return it
   */
  async updateState(): Promise<BrowserState> {
    try {
      this._state = await this._updateState();
      return this._state;
    } catch (error) {
      logger.error(`Failed to update browser state: ${error}`);
      throw error;
    }
  }

  /**
   * Update and return state
   */
  private async _updateState(): Promise<BrowserState> {
    const retryGetStableState = async (): Promise<BrowserState> => {
      let lastError: Error | null = null;
      const maxRetries = 3;

      // Implement retry logic similar to Python's tenacity.retry
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          if (!this.currentPage) {
            await this._initBrowser();
          }

          if (!this.currentPage) {
            throw new Error("Failed to initialize page");
          }

          const url = this.currentPage.url();
          const detectSheets = url.includes("docs.google.com/spreadsheets/d");
          const screenshotB64 = await this.fastScreenshot();

          // Use CV detection if available, otherwise use standard browser detection
          let interactiveElementsData: InteractiveElementsData;
          if (this.detector) {
            interactiveElementsData = await this.getInteractiveElementsWithCV(
              screenshotB64,
              detectSheets
            );
          } else {
            interactiveElementsData = await this.getInteractiveElementsData();
          }

          const interactiveElements: Record<number, InteractiveElement> = {};
          interactiveElementsData.elements.forEach((element) => {
            interactiveElements[element.index] = element;
          });

          // Create highlighted version of the screenshot
          const screenshotWithHighlights = putHighlightElementsOnScreenshot(
            interactiveElements,
            screenshotB64
          );

          const tabs = await this.getTabsInfo();

          return new BrowserState(
            url,
            tabs,
            interactiveElementsData.viewport,
            screenshotWithHighlights,
            screenshotB64,
            interactiveElements
          );
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          // Wait with exponential backoff before retrying
          const waitTime = Math.min(500 * Math.pow(2, attempt), 2000);
          logger.debug(`Retry attempt ${attempt + 1}, waiting ${waitTime}ms`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }

      throw lastError || new Error("Failed to get stable state after retries");
    };

    try {
      return await retryGetStableState();
    } catch (error) {
      logger.error(`Failed to update state after multiple attempts: ${error}`);

      // Return last known good state if available
      if (this._state) {
        return this._state;
      }

      throw error;
    }
  }

  /**
   * Get a stable state with retries
   */
  private async getStableState(): Promise<BrowserState> {
    // Could implement retries here like in the Python version
    if (!this.currentPage) {
      await this._initBrowser();
    }

    if (!this.currentPage) {
      throw new Error("Failed to initialize page");
    }

    const url = this.currentPage.url();

    const detectSheets = url.includes("docs.google.com/spreadsheets/d");

    const screenshotB64 = await this.fastScreenshot();

    // Use CV detection if available, otherwise use standard browser detection
    let interactiveElementsData: InteractiveElementsData;
    if (this.detector) {
      interactiveElementsData = await this.getInteractiveElementsWithCV(
        screenshotB64,
        detectSheets
      );
    } else {
      interactiveElementsData = await this.getInteractiveElementsData();
    }

    const interactiveElements: Record<number, InteractiveElement> = {};
    interactiveElementsData.elements.forEach((element) => {
      interactiveElements[element.index] = element;
    });

    // Create highlighted version of the screenshot
    const screenshotWithHighlights = putHighlightElementsOnScreenshot(
      interactiveElements,
      screenshotB64
    );

    const tabs = await this.getTabsInfo();

    return new BrowserState(
      url,
      tabs,
      interactiveElementsData.viewport,
      screenshotWithHighlights,
      screenshotB64,
      interactiveElements
    );
  }

  /**
   * Get all interactive elements on the page
   */
  async getInteractiveElementsData(): Promise<InteractiveElementsData> {
    const page = await this.getCurrentPage();
    const result = await page.evaluate(findVisibleInteractiveElementsScript);

    return result as InteractiveElementsData;
  }

  /**
   * Get interactive elements using combined browser and CV detection
   */
  async getInteractiveElementsWithCV(
    screenshotB64: string | null = null,
    detectSheets: boolean = false
  ): Promise<InteractiveElementsData> {
    if (!this.detector) {
      logger.warning(
        "CV detector not set up. Falling back to browser-only detection."
      );
      return this.getInteractiveElementsData();
    }

    // Take screenshot if not provided
    const finalScreenshotB64 = screenshotB64 || (await this.fastScreenshot());

    // Get browser-based detections and CV detections
    const [browserElementsData, cvElements] = await Promise.all([
      this.getInteractiveElementsData(),
      this.detector.detectFromImage(finalScreenshotB64, detectSheets),
    ]);

    // Combine and filter detections
    const combinedElements = combineAndFilterElements(
      browserElementsData.elements,
      cvElements
    );

    // Create new InteractiveElementsData with combined elements
    return {
      viewport: browserElementsData.viewport,
      elements: combinedElements,
    };
  }

  /**
   * Get or create a CDP session for the current page
   */
  async getCDPSession(): Promise<CDPSession> {
    if (!this.context || !this.currentPage) {
      throw new Error("Browser context or page not initialized");
    }

    // Create a new session if we don't have one or the page has changed
    if (
      !this._cdpSession ||
      (this._cdpSession as any)._page !== this.currentPage
    ) {
      this._cdpSession = await this.context.newCDPSession(this.currentPage);
      // Store reference to the page this session belongs to
      (this._cdpSession as any)._page = this.currentPage;
    }

    return this._cdpSession;
  }

  /**
   * Take a screenshot using CDP for better performance
   */
  async fastScreenshot(): Promise<string> {
    // Use cached CDP session instead of creating a new one each time
    const cdpSession = await this.getCDPSession();
    const screenshotParams = {
      format: "png",
      fromSurface: false,
      captureBeyondViewport: false,
    };

    // Capture screenshot using CDP Session
    const screenshotData = await cdpSession.send(
      "Page.captureScreenshot",
      screenshotParams
    );
    const screenshotB64 = screenshotData.data;

    return screenshotB64;
  }

  /**
   * Get cookies from the browser
   */
  async getCookies(): Promise<any[]> {
    if (this.context) {
      return await this.context.cookies();
    }
    return [];
  }

  /**
   * Get storage state from the browser
   */
  async getStorageState(): Promise<any> {
    if (this.context) {
      const cookies = await this.context.cookies();

      return {
        cookies,
      };
    }
    return {};
  }

  /**
   * Async context manager entry
   */
  async [Symbol.asyncDispose](): Promise<void> {
    if (this.closeContext) {
      await this.close();
    }
  }
}
