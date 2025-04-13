// src/browser/browser.ts
import * as fs from 'fs';
import * as path from 'path';
import * as playwright from 'playwright';
import { 
    BrowserError, 
    BrowserState, 
    InteractiveElement, 
    InteractiveElementsData, 
    TabInfo, 
    ViewportSchema
} from './models';
import { combineAndFilterElements, putHighlightElementsOnScreenshot } from './utils';
import { Detector } from './detector';

// Import element finder script as a string
const INTERACTIVE_ELEMENTS_JS_CODE = fs.readFileSync(
    path.join(__dirname, 'findVisibleInteractiveElements.js'),
    'utf-8'
);

interface ViewportSize {
    width: number;
    height: number;
}

export interface BrowserConfig {
    cdpUrl?: string;
    viewportSize?: ViewportSize;
    storageState?: playwright.StorageState;
    cvModelEndpoint?: string;
    sheetsModelEndpoint?: string;
}

export class Browser {
    private config: BrowserConfig;
    private closeContext: boolean;
    private playwright?: playwright.Playwright;
    private playwrightBrowser?: playwright.Browser;
    private context?: playwright.BrowserContext;
    private currentPage?: playwright.Page;
    private state: BrowserState;
    private cdpSession: any;
    private detector?: Detector;

    constructor(config: BrowserConfig = {}, closeContext: boolean = true) {
        console.log('Initializing browser');
        this.config = {
            viewportSize: { width: 1200, height: 900 },
            ...config
        };
        this.closeContext = closeContext;

        // Initialize state
        this.initState();

        // Set up CV detection if endpoints are provided
        if (this.config.cvModelEndpoint) {
            this.setupCVDetector(this.config.cvModelEndpoint, this.config.sheetsModelEndpoint);
        }
    }

    private initState(url: string = ''): void {
        this.state = {
            url,
            tabs: [],
            viewport: ViewportSchema.parse({}),
            screenshot_with_highlights: null,
            screenshot: null,
            interactive_elements: {},
        };
    }

    async init(): Promise<Browser> {
        await this.initBrowser();
        return this;
    }

    async initBrowser(): Promise<void> {
        console.log('Initializing browser context');
        
        // Start playwright if needed
        if (!this.playwright) {
            this.playwright = await playwright.chromium.launch();
        }
        
        // Initialize browser if needed
        if (!this.playwrightBrowser) {
            if (this.config.cdpUrl) {
                console.log(`Connecting to remote browser via CDP ${this.config.cdpUrl}`);
                this.playwrightBrowser = await playwright.chromium.connectOverCDP({
                    endpointURL: this.config.cdpUrl
                });
            } else {
                console.log('Launching new browser instance');
                this.playwrightBrowser = await playwright.chromium.launch({
                    headless: false,
                    args: [
                        '--no-sandbox',
                        '--disable-blink-features=AutomationControlled',
                        '--disable-web-security',
                        '--disable-site-isolation-trials',
                        '--disable-features=IsolateOrigins,site-per-process',
                        `--window-size=${this.config.viewportSize?.width || 1200},${this.config.viewportSize?.height || 900}`,
                    ]
                });
            }
        }
        
        // Create context if needed
        if (!this.context) {
            if (this.playwrightBrowser.contexts().length > 0) {
                this.context = this.playwrightBrowser.contexts()[0];
            } else {
                this.context = await this.playwrightBrowser.newContext({
                    viewport: this.config.viewportSize,
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.102 Safari/537.36',
                    javaScriptEnabled: true,
                    bypassCSP: true,
                    ignoreHTTPSErrors: true,
                });
                
                // Apply anti-detection scripts
                await this.applyAntiDetectionScripts();
            }
            
            this.context.on('page', this.onPageChange.bind(this));
            
            if (this.config.storageState && 'cookies' in this.config.storageState) {
                await this.context.addCookies(this.config.storageState.cookies);
            }
        }
        
        // Create page if needed
        if (!this.currentPage) {
            if (this.context.pages().length > 0) {
                this.currentPage = this.context.pages()[this.context.pages().length - 1];
            } else {
                this.currentPage = await this.context.newPage();
            }
        }
    }

    private async onPageChange(page: playwright.Page): Promise<void> {
        console.log(`Current page changed to ${page.url()}`);
        
        if (this.context) {
            this.cdpSession = await this.context.newCDPSession(page);
        }
        this.currentPage = page;
    }

    setupCVDetector(cvEndpointName?: string, sheetsEndpointName?: string): Detector | undefined {
        if (!cvEndpointName && !this.config.cvModelEndpoint) {
            console.log("No CV model endpoint provided, skipping CV detector setup");
            return;
        }
            
        // Use provided endpoint or fall back to config
        const cvEndpoint = cvEndpointName || this.config.cvModelEndpoint;
        const sheetsEndpoint = sheetsEndpointName || this.config.sheetsModelEndpoint;

        this.detector = new Detector(cvEndpoint, sheetsEndpoint);
        
        return this.detector;
    }

    private async applyAntiDetectionScripts(): Promise<void> {
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

    async close(): Promise<void> {
        console.log('Closing browser');
        
        try {
            // Close CDP session if exists
            this.cdpSession = null;
            
            // Close context
            if (this.context) {
                try {
                    await this.context.close();
                } catch (e) {
                    console.log(`Failed to close context: ${e}`);
                }
                this.context = undefined;
            }
            
            // Close browser
            if (this.playwrightBrowser) {
                try {
                    await this.playwrightBrowser.close();
                } catch (e) {
                    console.log(`Failed to close browser: ${e}`);
                }
                this.playwrightBrowser = undefined;
            }
            
            // Stop playwright
            if (this.playwright) {
                // Playwright doesn't have an explicit stop method in TS
                this.playwright = undefined;
            }
        } catch (e) {
            console.error(`Error during browser cleanup: ${e}`);
        } finally {
            this.context = undefined;
            this.currentPage = undefined;
            this.state = {
                url: '',
                tabs: [],
                viewport: ViewportSchema.parse({}),
                screenshot_with_highlights: null,
                screenshot: null,
                interactive_elements: {},
            };
            this.playwrightBrowser = undefined;
            this.playwright = undefined;
        }
    }

    async navigateTo(url: string): Promise<void> {
        const page = await this.getCurrentPage();
        await page.goto(url, { waitUntil: 'domcontentloaded' });
    }

    async refreshPage(): Promise<void> {
        const page = await this.getCurrentPage();
        await page.reload();
        await page.waitForLoadState();
    }

    async goForward(): Promise<void> {
        const page = await this.getCurrentPage();
            
        try {
            await page.goForward({ timeout: 10000, waitUntil: 'domcontentloaded' });
        } catch (e) {
            console.log(`During go_forward: ${e}`);
        }
    }

    async getTabsInfo(): Promise<TabInfo[]> {
        if (!this.context) {
            await this.initBrowser();
        }
        
        const tabsInfo: TabInfo[] = [];
        const pages = this.context!.pages();
        
        for (let pageId = 0; pageId < pages.length; pageId++) {
            const page = pages[pageId];
            tabsInfo.push({
                page_id: pageId,
                url: page.url(),
                title: await page.title()
            });
        }

        return tabsInfo;
    }

    async switchToTab(pageId: number): Promise<void> {
        if (!this.context) {
            await this.initBrowser();
        }

        const pages = this.context!.pages();
        if (pageId >= pages.length) {
            throw new BrowserError(`No tab found with page_id: ${pageId}`);
        }

        const page = pages[pageId];
        this.currentPage = page;

        await page.bringToFront();
        await page.waitForLoadState();
    }

    async createNewTab(url?: string): Promise<void> {
        if (!this.context) {
            await this.initBrowser();
        }

        const newPage = await this.context!.newPage();
        this.currentPage = newPage;

        await newPage.waitForLoadState();

        if (url) {
            await newPage.goto(url, { waitUntil: 'domcontentloaded' });
        }
    }

    async closeCurrentTab(): Promise<void> {
        if (!this.currentPage) {
            return;
        }
            
        await this.currentPage.close();

        // Switch to the first available tab if any exist
        if (this.context && this.context.pages().length > 0) {
            await this.switchToTab(0);
        }
    }

    async getCurrentPage(): Promise<playwright.Page> {
        if (!this.currentPage) {
            await this.initBrowser();
        }
        return this.currentPage!;
    }

    getState(): BrowserState {
        return this.state;
    }

    async updateState(): Promise<BrowserState> {
        this.state = await this.fetchState();
        return this.state;
    }

    private async fetchState(): Promise<BrowserState> {
        try {
            if (!this.currentPage) {
                await this.initBrowser();
            }
            
            const url = this.currentPage!.url();
            const detectSheets = url.includes('docs.google.com/spreadsheets/d');

            const screenshotB64 = await this.fastScreenshot();
            
            // Use CV detection if available, otherwise use standard browser detection
            let interactiveElementsData: InteractiveElementsData;
            if (this.detector) {
                interactiveElementsData = await this.getInteractiveElementsWithCV(screenshotB64, detectSheets);
            } else {
                interactiveElementsData = await this.getInteractiveElementsData();
            }
            
            const interactiveElements: Record<number, InteractiveElement> = {};
            interactiveElementsData.elements.forEach(element => {
                interactiveElements[element.index] = element;
            });
            
            // Create highlighted version of the screenshot
            const screenshotWithHighlights = await putHighlightElementsOnScreenshot(
                interactiveElements, 
                screenshotB64
            );
            
            const tabs = await this.getTabsInfo();

            return {
                url,
                tabs,
                screenshot_with_highlights: screenshotWithHighlights,
                screenshot: screenshotB64,
                viewport: interactiveElementsData.viewport,
                interactive_elements: interactiveElements,
            };
        } catch (error) {
            console.error(`Failed to update state: ${error}`);
            // Return last known good state if available
            if (this.state) {
                return this.state;
            }
            throw error;
        }
    }

    async getInteractiveElementsData(): Promise<InteractiveElementsData> {
        const page = await this.getCurrentPage();
        const result = await page.evaluate(INTERACTIVE_ELEMENTS_JS_CODE);
        
        // Make sure the result matches our expected format
        const interactiveElementsData = result as InteractiveElementsData;

        return interactiveElementsData;
    }

    async getInteractiveElementsWithCV(
        screenshotB64?: string, 
        detectSheets: boolean = false
    ): Promise<InteractiveElementsData> {
        if (!this.detector) {
            console.warn("CV detector not set up. Falling back to browser-only detection.");
            return await this.getInteractiveElementsData();
        }
        
        // Take screenshot if not provided
        if (!screenshotB64) {
            screenshotB64 = await this.fastScreenshot();
        }
        
        // Get browser-based detections and CV-based detections in parallel
        const [browserElementsData, cvElements] = await Promise.all([
            this.getInteractiveElementsData(),
            this.detector.detectFromImage(screenshotB64, detectSheets)
        ]);
        
        // Combine and filter detections
        const combinedElements = combineAndFilterElements(
            browserElementsData.elements, 
            cvElements
        );
        
        // Create new InteractiveElementsData with combined elements
        return {
            viewport: browserElementsData.viewport,
            elements: combinedElements
        };
    }

    async getCdpSession(): Promise<any> {
        // Create a new session if we don't have one or the page has changed
        if (!this.cdpSession || 
            !this.cdpSession._page || 
            this.cdpSession._page !== this.currentPage) {
            if (!this.context || !this.currentPage) {
                await this.initBrowser();
            }
            this.cdpSession = await this.context!.newCDPSession(this.currentPage!);
            // Store reference to the page this session belongs to
            this.cdpSession._page = this.currentPage;
        }
            
        return this.cdpSession;
    }

    async fastScreenshot(): Promise<string> {
        // Use cached CDP session instead of creating a new one each time
        const cdpSession = await this.getCdpSession();
        const screenshotParams = {
            format: "png",
            fromSurface: false,
            captureBeyondViewport: false
        };
        
        try {
            // Capture screenshot using CDP Session
            const screenshotData = await cdpSession.send("Page.captureScreenshot", screenshotParams);
            const screenshotB64 = screenshotData.data;
            
            return screenshotB64;
        } catch (error) {
            console.error("Error capturing screenshot with CDP:", error);
            // Fallback to Playwright's screenshot method
            const screenshotBuffer = await this.currentPage!.screenshot({ type: 'png' });
            return screenshotBuffer.toString('base64');
        }
    }

    async getCookies(): Promise<any[]> {
        if (this.context) {
            const cookies = await this.context.cookies();
            return cookies;
        }
        return [];
    }
    
    async getStorageState(): Promise<playwright.StorageState> {
        if (this.context) {
            const cookies = await this.context.cookies();
            return { cookies, origins: [] };
        }
        return { cookies: [], origins: [] };
    }
}
