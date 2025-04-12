import pino from "pino";
import { ActionResult } from "../agent/models.js";
import { Browser } from "../browser/browser.js";
import { Controller } from "./controller.js";
import { BrowserContext, Page } from "playwright";

const logger = pino({ name: "default_actions" });

/**
 * Register the default set of actions with the controller
 * @param controller - The controller to register actions with
 * @param outputModel - Optional model for action outputs
 */
export function registerDefaultActions(
  controller: Controller,
  outputModel: any = null
): void {
  // Task completion action
  controller.registerAction(
    "done",
    "Complete task",
    async ({ text }: { text: string }) => {
      return new ActionResult({
        isDone: true,
        content: text,
      });
    },
    false
  );

  // Give human control action
  controller.registerAction(
    "give_human_control",
    "Give human control of the browser. Use this action when you need to use user information, such as first name, last name, email, phone number, booking information, login/password, etc. to proceed with the task. Also, if you can't solve the CAPTCHA, use this action.",
    async ({ message, browser }: { message: string; browser: Browser }) => {
      return new ActionResult({
        giveControl: true,
        content: message,
        isDone: true,
      });
    },
    true
  );

  // Search Google action
  controller.registerAction(
    "search_google",
    "Open google search in new tab and search for the query.",
    async ({ query, browser }: { query: string; browser: Browser }) => {
      const page = await browser.getCurrentPage();
      await page.goto(`https://www.google.com/search?q=${query}&udm=14`);
      await page.waitForLoadState();
      const msg = `Searched for '${query}' in Google`;
      logger.info(msg);
      return new ActionResult({ content: msg });
    },
    true
  );

  // Navigate to URL action
  controller.registerAction(
    "go_to_url",
    "Navigate to URL in the current tab",
    async ({ url, browser }: { url: string; browser: Browser }) => {
      try {
        const page = await browser.getCurrentPage();
        await page.goto(url);
        // Small delay to allow page to stabilize
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const msg = `Navigated to ${url}`;
        logger.info(msg);
        return new ActionResult({ content: msg });
      } catch (error) {
        // Add automatic retry logic in the future
        return new ActionResult({ error: String(error) });
      }
    },
    true
  );

  // Go back action
  controller.registerAction(
    "go_back_to_previous_page",
    "Go back to the previous page",
    async ({ browser }: { browser: Browser }) => {
      try {
        const page = await browser.getCurrentPage();
        await page.goBack({ waitUntil: "domcontentloaded" });
        // Wait for the page to stabilize
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const msg = "Navigated back to the previous page";
        logger.info(msg);
        return new ActionResult({ content: msg });
      } catch (error) {
        logger.debug(`During go_back: ${error}`);
        return new ActionResult({ error: String(error) });
      }
    },
    true
  );

  // Click on spreadsheet cell action
  controller.registerAction(
    "click_on_spreadsheet_cell",
    "Click on a spreadsheet cell at a specific row and column. You HAVE to use this action when you need to click on a cell in a spreadsheet. DON'T try to use click_element action, it will not work.",
    async ({
      row,
      column,
      browser,
    }: {
      row: string;
      column: string;
      browser: Browser;
    }) => {
      const page = await browser.getCurrentPage();
      const state = browser.getState();

      const elements = Object.values(state.interactiveElements);

      const rowElement = elements.find(
        (e) => e.browserAgentId === `row_${row}`
      );
      const columnElement = elements.find(
        (e) => e.browserAgentId === `column_${column}`
      );

      if (!rowElement || !columnElement) {
        return new ActionResult({
          error:
            "Row or column element not found - pay close attention to the row and column numbers.",
        });
      }

      // Reset click just in case
      await page.mouse.click(
        state.viewport.width / 2,
        state.viewport.height / 2
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      await page.mouse.move(columnElement.center.x, rowElement.center.y);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await page.mouse.click(columnElement.center.x, rowElement.center.y);
      await new Promise((resolve) => setTimeout(resolve, 50));

      return new ActionResult({
        content: `Clicked on spreadsheet cell with row ${row} and column ${column}`,
      });
    },
    true
  );

  // Click element action
  controller.registerAction(
    "click_element",
    "Click on the element with index.",
    async ({
      index,
      wait_after_click,
      browser,
    }: {
      index: number | string;
      wait_after_click: boolean;
      browser: Browser;
    }) => {
      // Clean index if it contains any non-numeric characters
      const cleanedIndexStr = String(index).replace(/\D/g, "");
      if (cleanedIndexStr === "") {
        logger.error(`Index is not a number. Index: ${index}`);
        return new ActionResult({ error: "`index` should be a valid number." });
      }

      const cleanIndex = parseInt(cleanedIndexStr, 10);
      const state = browser.getState();

      if (!(cleanIndex in state.interactiveElements)) {
        return new ActionResult({
          error: `Element with index ${cleanIndex} does not exist - retry or use alternative actions.`,
        });
      }

      const element = state.interactiveElements[cleanIndex];
      const initialPages = browser.context?.pages?.length || 0;

      try {
        const page = await browser.getCurrentPage();

        // Approach 1: Try precise mouse movement and click
        await page.mouse.move(element.center.x, element.center.y);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await page.mouse.click(element.center.x, element.center.y);

        // Wait for a short time to see if a new tab opened or any navigation occurred
        await new Promise((resolve) => setTimeout(resolve, 500));

        let msg = `Clicked element with index ${cleanIndex}: <${element.tagName}>${element.text}</${element.tagName}>`;

        // Check if a new tab was opened
        if (
          browser.context &&
          browser.context.pages &&
          browser.context.pages.length > initialPages
        ) {
          const newTabMsg = "New tab opened - switching to it";
          msg += ` - ${newTabMsg}`;
          logger.info(newTabMsg);
          await browser.switchToTab(browser.context.pages.length - 1);
        }

        // Additional waiting if specified
        if (wait_after_click) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          try {
            // Try to wait for navigation if applicable
            await page.waitForLoadState("domcontentloaded", { timeout: 3000 });
          } catch (err) {
            // Ignore navigation timeout errors - not all clicks cause navigation
          }
        }

        logger.info(msg);
        return new ActionResult({ content: msg });
      } catch (error) {
        // If click fails with precise coordinates, try alternative approach
        try {
          logger.info(
            `First click attempt failed, trying alternative approach for element ${cleanIndex}`
          );

          // Approach 2: Try to click via element handle (more reliable in some cases)
          const page = await browser.getCurrentPage();

          // Try to identify the element using browser-specific selectors
          const selector = element.attributes?.id
            ? `#${element.attributes.id}`
            : element.attributes?.class
            ? `.${element.attributes.class.split(" ")[0]}`
            : `${element.tagName}:nth-of-type(${cleanIndex})`;

          try {
            const elementHandle = await page.$(selector);
            if (elementHandle) {
              await elementHandle.click();

              // Wait a moment to see if anything happened as a result of the click
              await new Promise((resolve) => setTimeout(resolve, 500));

              const msg = `Clicked element with index ${cleanIndex} using alternative method`;
              logger.info(msg);

              // Check for new tabs
              if (browser.context?.pages?.length > initialPages) {
                await browser.switchToTab(browser.context.pages.length - 1);
              }

              if (wait_after_click) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
              }

              return new ActionResult({ content: msg });
            }
          } catch (selectorError) {
            // Approach 3: Last resort - try JavaScript click
            try {
              await page.evaluate((idx) => {
                const elements = document.querySelectorAll("*");
                for (const el of Array.from(elements)) {
                  if ((el as any).browserAgentId === idx.toString()) {
                    (el as HTMLElement).click();
                    return true;
                  }
                }
                return false;
              }, cleanIndex);

              const msg = `Attempted JavaScript click on element with index ${cleanIndex}`;
              logger.info(msg);

              return new ActionResult({ content: msg });
            } catch (jsError) {
              throw error; // Throw the original error if all approaches fail
            }
          }
        } catch (fallbackError) {
          logger.error(
            `All click attempts failed for element ${cleanIndex}: ${fallbackError}`
          );
          return new ActionResult({
            error: `Failed to click element ${cleanIndex}: ${error}`,
            content:
              "Click attempt failed, you might need to try a different approach",
          });
        }
      }

      return new ActionResult({
        error: `Unexpected error clicking element ${cleanIndex}`,
        content: "Click attempt had unexpected outcome",
      });
    },
    true
  );

  // Wait for page to load action
  controller.registerAction(
    "wait_for_page_to_load",
    "Use this action to wait for the page to load, if you see that the content on the clean screenshot is empty or loading UI elements such as skeleton screens. This action will wait for page to load. Then you can continue with your actions.",
    async ({ browser }: { browser: Browser }) => {
      try {
        const page = await browser.getCurrentPage();

        // Wait for the three main load states sequentially
        await page.waitForLoadState("domcontentloaded");
        await page.waitForLoadState("load");

        // Add a small delay to wait for any dynamic content to load
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Try to wait for network to be idle, but don't fail if it times out
        try {
          await page.waitForLoadState("networkidle", { timeout: 5000 });
        } catch (error) {
          logger.info("Network didn't reach idle state, continuing anyway");
        }

        return new ActionResult({
          content: "Waited for page to load completely",
        });
      } catch (error) {
        logger.error(`Error waiting for page to load: ${error}`);
        return new ActionResult({
          error: `Failed to wait for page to load: ${error}`,
          content:
            "Attempted to wait for page to load but encountered an issue",
        });
      }
    },
    true
  );

  // Enter text action
  controller.registerAction(
    "enter_text",
    "Enter text with a keyboard. Use it AFTER you have clicked on an input element. This action will override the current text in the element.",
    async ({
      text,
      press_enter,
      browser,
    }: {
      text: string;
      press_enter: boolean;
      browser: Browser;
    }) => {
      try {
        const page = await browser.getCurrentPage();

        // Try multiple methods to ensure text clearing works reliably

        // Method 1: Use keyboard shortcuts to select all and delete
        const isMac = process.platform === "darwin";
        await page.keyboard.press(isMac ? "Meta+a" : "Control+a");
        await new Promise((resolve) => setTimeout(resolve, 150));
        await page.keyboard.press("Backspace");
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Method 2: Try to use triple click to ensure text is selected, which works better in some inputs
        try {
          const activeElement = await page.evaluateHandle(
            () => document.activeElement
          );
          if (activeElement) {
            await activeElement.click({ clickCount: 3 });
            await new Promise((resolve) => setTimeout(resolve, 100));
            await page.keyboard.press("Backspace");
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } catch (error) {
          // Ignore errors from this approach - we'll still try to type
          logger.debug(
            `Triple-click select failed, continuing with direct typing: ${error}`
          );
        }

        // Input text into the element - type slowly to ensure accuracy
        await page.keyboard.type(text, { delay: 20 });

        if (press_enter) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          await page.keyboard.press("Enter");

          // Wait for potential navigation or form submission
          try {
            await page.waitForLoadState("domcontentloaded", { timeout: 3000 });
          } catch (error) {
            // Some Enter presses don't lead to navigation, so we ignore this error
          }
        }

        const msg = `Entered "${text}" on the keyboard. Make sure to double check that the text was entered to where you intended.`;
        logger.info(msg);
        return new ActionResult({ content: msg });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Failed to enter text: ${errorMessage}`);

        return new ActionResult({
          error: `Failed to enter text: ${errorMessage}`,
          content:
            "Text entry attempt had issues, please verify if it worked or try again",
        });
      }
    },
    true
  );

  // Tab management actions
  controller.registerAction(
    "switch_tab",
    "Switch tab",
    async ({ page_id, browser }: { page_id: number; browser: Browser }) => {
      await browser.switchToTab(page_id);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const msg = `Switched to tab ${page_id}`;
      logger.info(msg);
      return new ActionResult({ content: msg });
    },
    true
  );

  controller.registerAction(
    "open_tab",
    "Open url in new tab",
    async ({ url, browser }: { url: string; browser: Browser }) => {
      await browser.createNewTab(url);
      const msg = `Opened new tab with ${url}`;
      logger.info(msg);
      return new ActionResult({ content: msg });
    },
    true
  );

  // Scroll actions
  controller.registerAction(
    "scroll_page_down",
    "Scroll entire page down. Use this action when you want to scroll entire page down to load more content. DON'T use this action if you want to scroll over a scrollable element.",
    async ({ browser }: { browser: Browser }) => {
      const page = await browser.getCurrentPage();
      const state = browser.getState();

      // Move mouse to the center of the page
      await page.mouse.move(
        state.viewport.width / 2,
        state.viewport.height / 2
      );
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Scroll down by one page
      await page.mouse.wheel(0, state.viewport.height * 0.8);

      return new ActionResult({
        content:
          "Scrolled mouse wheel down (it doesn't guarantee that something has scrolled, you need to check new state screenshot to confirm)",
      });
    },
    true
  );

  controller.registerAction(
    "scroll_page_up",
    "Scroll entire page up. Use this action when you want to scroll entire page up to load more content. DON'T use this action if you want to scroll over a scrollable element.",
    async ({ browser }: { browser: Browser }) => {
      const page = await browser.getCurrentPage();
      const state = browser.getState();

      // Move mouse to the center of the page
      await page.mouse.move(
        state.viewport.width / 2,
        state.viewport.height / 2
      );
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Scroll up by one page
      await page.mouse.wheel(0, -state.viewport.height * 0.8);

      return new ActionResult({
        content:
          "Scrolled mouse wheel up (it doesn't guarantee that something has scrolled, you need to check new state screenshot to confirm)",
      });
    },
    true
  );

  controller.registerAction(
    "scroll_down_over_element",
    "Moves mouse to the element with index `index`, located inside scrollable area of the webpage, identified by scrollbars. Then scrolls mouse wheel down.",
    async ({ index, browser }: { index: number; browser: Browser }) => {
      const page = await browser.getCurrentPage();
      const state = browser.getState();

      if (!(index in state.interactiveElements)) {
        return new ActionResult({
          error: `Element index ${index} does not exist - retry or use alternative actions`,
        });
      }

      const element = state.interactiveElements[index];

      await page.mouse.move(element.center.x, element.center.y);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await page.mouse.wheel(0, state.viewport.height / 3);

      return new ActionResult({
        content: `Move mouse to element with index ${index} and scroll mouse wheel down. (It doesn't guarantee that something has scrolled, you need to check new state screenshot to confirm)`,
      });
    },
    true
  );

  controller.registerAction(
    "scroll_up_over_element",
    "Moves mouse to the element with index `index`, located inside scrollable area of the webpage, identified by scrollbars. Then scrolls mouse wheel up.",
    async ({ index, browser }: { index: number; browser: Browser }) => {
      const page = await browser.getCurrentPage();
      const state = browser.getState();

      if (!(index in state.interactiveElements)) {
        return new ActionResult({
          error: `Element index ${index} does not exist - retry or use alternative actions`,
        });
      }

      const element = state.interactiveElements[index];

      await page.mouse.move(element.center.x, element.center.y);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await page.mouse.wheel(0, -state.viewport.height / 3);

      return new ActionResult({
        content: `Move mouse to element with index ${index} and scroll mouse wheel up. (It doesn't guarantee that something has scrolled, you need to check new state screenshot to confirm)`,
      });
    },
    true
  );

  // Keyboard actions
  controller.registerAction(
    "press_enter",
    "Press enter key. Use this action when you need to submit a form or perform an action that requires pressing enter.",
    async ({ browser }: { browser: Browser }) => {
      const page = await browser.getCurrentPage();

      await page.keyboard.press("Enter");
      return new ActionResult({ content: "Pressed enter key" });
    },
    true
  );

  controller.registerAction(
    "clear_text_in_element",
    "Remove all text in the element with index.",
    async ({ index, browser }: { index: number; browser: Browser }) => {
      const page = await browser.getCurrentPage();
      const state = browser.getState();

      if (!(index in state.interactiveElements)) {
        return new ActionResult({
          error: `Element index ${index} does not exist - retry or use alternative actions`,
        });
      }

      const element = state.interactiveElements[index];

      await page.mouse.move(element.center.x, element.center.y);
      await page.mouse.click(element.center.x, element.center.y);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const isMac = process.platform === "darwin";
      await page.keyboard.press(isMac ? "Meta+A" : "Control+A");
      await new Promise((resolve) => setTimeout(resolve, 100));
      await page.keyboard.press("Backspace");

      return new ActionResult({
        content: "Removed all text in the element with index",
      });
    },
    true
  );
}
