// src/controller/default_actions.ts
import * as playwright from 'playwright';
import { ActionResult } from './models';
import { Controller } from './controller';
import { Browser } from '@/browser/browser';

/**
 * Register all default browser actions to the provided controller
 * 
 * @param controller - The controller to register actions with
 */
export function registerDefaultActions(controller: Controller): void {
    
    // Task completion action
    controller.registerAction(
        'done',
        'Complete task',
        async ({ text }: { text: string }): Promise<ActionResult> => {
            return { is_done: true, content: text };
        }
    );
    
    // Human control handover action
    controller.registerAction(
        'give_human_control',
        'Give human control of the browser. Use this action when you need to use user information, such as first name, last name, email, phone number, booking information, login/password, etc. to proceed with the task. Also, if you can\'t solve the CAPTCHA, use this action.',
        async ({ message, browser }: { message: string, browser: Browser }): Promise<ActionResult> => {
            return { give_control: true, content: message, is_done: true };
        },
        true
    );
    
    // Google search action
    controller.registerAction(
        'search_google',
        'Open Google search in new tab and search for the query.',
        async ({ query, browser }: { query: string, browser: Browser }): Promise<ActionResult> => {
            const page = await browser.getCurrentPage();
            await page.goto(`https://www.google.com/search?q=${query}&udm=14`);
            await page.waitForLoadState();
            const msg = `Searched for '${query}' in Google`;
            console.log(msg);
            return { content: msg };
        },
        true
    );
    
    // URL navigation action
    controller.registerAction(
        'go_to_url',
        'Navigate to URL in the current tab',
        async ({ url, browser }: { url: string, browser: Browser }): Promise<ActionResult> => {
            const page = await browser.getCurrentPage();
            // Large timeout for remote browsers
            await page.goto(url);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
            const msg = `Navigated to ${url}`;
            console.log(msg);
            return { content: msg };
        },
        true
    );
    
    // Go back action
    controller.registerAction(
        'go_back_to_previous_page',
        'Go back to the previous page',
        async ({ browser }: { browser: Browser }): Promise<ActionResult> => {
            try {
                const page = await browser.getCurrentPage();            
                await page.goBack({ waitUntil: 'domcontentloaded' });
                // Wait for the page to stabilize
                await new Promise(resolve => setTimeout(resolve, 1000));
                const msg = 'Navigated back to the previous page';
                console.log(msg);
                return { content: msg };
            } catch (e) {
                console.log(`During go_back: ${e}`);
                return { error: String(e) };
            }
        },
        true
    );
    
    // Spreadsheet cell click action
    controller.registerAction(
        'click_on_spreadsheet_cell',
        'Click on a spreadsheet cell at a specific row and column. You HAVE to use this action when you need to click on a cell in a spreadsheet. DON\'T try to use click_element action, it will not work.',
        async ({ row, column, browser }: { row: string, column: string, browser: Browser }): Promise<ActionResult> => {
            const page = await browser.getCurrentPage();
            const state = browser.getState();
            
            const elements = Object.values(state.interactive_elements);
            
            const rowElement = elements.find(e => e.browser_agent_id === `row_${row}`);
            const columnElement = elements.find(e => e.browser_agent_id === `column_${column}`);
            
            if (!rowElement || !columnElement) {
                return { 
                    error: 'Row or column element not found - pay close attention to the row and column numbers.' 
                };
            }
            
            // Reset click just in case
            await page.mouse.click(state.viewport.width / 2, state.viewport.height / 2);
            await new Promise(resolve => setTimeout(resolve, 50));
            
            await page.mouse.move(columnElement.center.x, rowElement.center.y);
            await new Promise(resolve => setTimeout(resolve, 50));
            await page.mouse.click(columnElement.center.x, rowElement.center.y);
            await new Promise(resolve => setTimeout(resolve, 50));
            
            return { content: `Clicked on spreadsheet cell with row ${row} and column ${column}` };
        },
        true
    );
    
    // Element click action
    controller.registerAction(
        'click_element',
        'Click on the element with index.',
        async ({ index, wait_after_click, browser }: { index: number, wait_after_click: boolean, browser: Browser }): Promise<ActionResult> => {
            // Clean index if it contains any non-numeric characters
            const cleanedIndexStr = String(index).replace(/\D/g, '');
            if (cleanedIndexStr === '') {
                console.error(`Index is not a number. Index: ${index}`);
                return { error: "`index` should be a valid number." };
            }
            
            const cleanedIndex = parseInt(cleanedIndexStr);
            const state = browser.getState();
            
            if (!(cleanedIndex in state.interactive_elements)) {
                return { 
                    error: `Element with index ${cleanedIndex} does not exist - retry or use alternative actions.` 
                };
            }
            
            const element = state.interactive_elements[cleanedIndex];
            const initialPages = browser.context?.pages().length || 0;
            
            try {
                const page = await browser.getCurrentPage();
                
                await page.mouse.move(element.center.x, element.center.y);
                await new Promise(resolve => setTimeout(resolve, 100));
                await page.mouse.click(element.center.x, element.center.y);
                
                let msg = `Clicked element with index ${cleanedIndex}: <${element.tag_name}></${element.tag_name}>`;
                
                console.log(msg);
                if (browser.context && browser.context.pages().length > initialPages) {
                    const newTabMsg = 'New tab opened - switching to it';
                    msg += ` - ${newTabMsg}`;
                    console.log(newTabMsg);
                    await browser.switchToTab(browser.context.pages().length - 1);
                }
                
                if (wait_after_click) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                
                return { content: msg };
            } catch (e) {
                return { error: String(e) };
            }
        },
        true
    );
    
    // Wait for page load action
    controller.registerAction(
        'wait_for_page_to_load',
        'Use this action to wait for the page to load, if you see that the content on the clean screenshot is empty or loading UI elements such as skeleton screens. This action will wait for page to load. Then you can continue with your actions.',
        async (): Promise<ActionResult> => {
            return { content: 'Waited for page to load' };
        }
    );
    
    // Text entry action
    controller.registerAction(
        'enter_text',
        'Enter text with a keyboard. Use it AFTER you have clicked on an input element. This action will override the current text in the element.',
        async ({ text, press_enter, browser }: { text: string, press_enter: boolean, browser: Browser }): Promise<ActionResult> => {
            try {
                const page = await browser.getCurrentPage();
                // Clear the element
                await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
                await new Promise(resolve => setTimeout(resolve, 100));
                await page.keyboard.press('Backspace');
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Input text into the element
                await page.keyboard.type(text);
                
                if (press_enter) {
                    await page.keyboard.press('Enter');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                
                const msg = `Entered "${text}" on the keyboard. Make sure to double check that the text was entered to where you intended.`;
                console.log(msg);
                return { content: msg };
            } catch (e) {
                return { error: `Failed to enter text. Error: ${e}` };
            }
        },
        true
    );
    
    // Tab management actions
    controller.registerAction(
        'switch_tab',
        'Switch tab',
        async ({ page_id, browser }: { page_id: number, browser: Browser }): Promise<ActionResult> => {
            await browser.switchToTab(page_id);
            await new Promise(resolve => setTimeout(resolve, 500));
            const msg = `Switched to tab ${page_id}`;
            console.log(msg);
            return { content: msg };
        },
        true
    );
    
    controller.registerAction(
        'open_tab',
        'Open url in new tab',
        async ({ url, browser }: { url: string, browser: Browser }): Promise<ActionResult> => {
            await browser.createNewTab(url);
            const msg = `Opened new tab with ${url}`;
            console.log(msg);
            return { content: msg };
        },
        true
    );
    
    // Page scrolling actions
    controller.registerAction(
        'scroll_page_down',
        "Scroll entire page down. Use this action when you want to scroll entire page down to load more content. DON'T use this action if you want to scroll over a scrollable element.",
        async ({ browser }: { browser: Browser }): Promise<ActionResult> => {
            const page = await browser.getCurrentPage();
            const state = browser.getState();
            // Move mouse to the center of the page
            await page.mouse.move(state.viewport.width / 2, state.viewport.height / 2);
            await new Promise(resolve => setTimeout(resolve, 100));
            // Scroll down by one page
            await page.mouse.wheel(0, state.viewport.height * 0.8);
            return { 
                content: "Scrolled mouse wheel down (it doesn't guarantee that something has scrolled, you need to check new state screenshot to confirm)" 
            };
        },
        true
    );
    
    controller.registerAction(
        'scroll_page_up',
        "Scroll entire page up. Use this action when you want to scroll entire page up to load more content. DON'T use this action if you want to scroll over a scrollable element.",
        async ({ browser }: { browser: Browser }): Promise<ActionResult> => {
            const page = await browser.getCurrentPage();
            const state = browser.getState();
            // Move mouse to the center of the page
            await page.mouse.move(state.viewport.width / 2, state.viewport.height / 2);
            await new Promise(resolve => setTimeout(resolve, 100));
            // Scroll up by one page
            await page.mouse.wheel(0, -state.viewport.height * 0.8);
            return { 
                content: "Scrolled mouse wheel up (it doesn't guarantee that something has scrolled, you need to check new state screenshot to confirm)" 
            };
        },
        true
    );
    
    controller.registerAction(
        'scroll_down_over_element',
        "Moves mouse to the element with index `index`, located inside scrollable area of the webpage, identified by scrollbars. Then scrolls mouse wheel down.",
        async ({ index, browser }: { index: number, browser: Browser }): Promise<ActionResult> => {
            const page = await browser.getCurrentPage();
            const state = browser.getState();
            
            if (!(index in state.interactive_elements)) {
                return { 
                    error: `Element index ${index} does not exist - retry or use alternative actions` 
                };
            }
            
            const element = state.interactive_elements[index];
            
            await page.mouse.move(element.center.x, element.center.y);
            await new Promise(resolve => setTimeout(resolve, 100));
            await page.mouse.wheel(0, state.viewport.height / 3);
            
            return { 
                content: `Move mouse to element with index ${index} and scroll mouse wheel down. (It doesn't guarantee that something has scrolled, you need to check new state screenshot to confirm)` 
            };
        },
        true
    );
    
    controller.registerAction(
        'scroll_up_over_element',
        "Moves mouse to the element with index `index`, located inside scrollable area of the webpage, identified by scrollbars. Then scrolls mouse wheel up.",
        async ({ index, browser }: { index: number, browser: Browser }): Promise<ActionResult> => {
            const page = await browser.getCurrentPage();
            const state = browser.getState();
            
            if (!(index in state.interactive_elements)) {
                return { 
                    error: `Element index ${index} does not exist - retry or use alternative actions` 
                };
            }
            
            const element = state.interactive_elements[index];
            
            await page.mouse.move(element.center.x, element.center.y);
            await new Promise(resolve => setTimeout(resolve, 100));
            await page.mouse.wheel(0, -state.viewport.height / 3);
            
            return { 
                content: `Move mouse to element with index ${index} and scroll mouse wheel up. (It doesn't guarantee that something has scrolled, you need to check new state screenshot to confirm)` 
            };
        },
        true
    );
    
    controller.registerAction(
        'press_enter',
        'Press enter key. Use this action when you need to submit a form or perform an action that requires pressing enter.',
        async ({ browser }: { browser: Browser }): Promise<ActionResult> => {
            const page = await browser.getCurrentPage();
            await page.keyboard.press('Enter');
            return { content: 'Pressed enter key' };
        },
        true
    );
    
    controller.registerAction(
        'clear_text_in_element',
        'Remove all text in the element with index.',
        async ({ index, browser }: { index: number, browser: Browser }): Promise<ActionResult> => {
            const page = await browser.getCurrentPage();
            const state = browser.getState();
            
            if (!(index in state.interactive_elements)) {
                return { 
                    error: `Element index ${index} does not exist - retry or use alternative actions` 
                };
            }
            
            const element = state.interactive_elements[index];
            
            await page.mouse.move(element.center.x, element.center.y);
            await page.mouse.click(element.center.x, element.center.y);
            await new Promise(resolve => setTimeout(resolve, 100));
            
            if (process.platform === "darwin") {
                await page.keyboard.press('Meta+A');
            } else {
                await page.keyboard.press('Control+A');
            }
            await new Promise(resolve => setTimeout(resolve, 100));
            await page.keyboard.press('Backspace');
            
            return { content: 'Removed all text in the element with index' };
        },
        true
    );
    
    // Dropdown interaction actions
    controller.registerAction(
        'get_select_options',
        'Get all options from a <select> element. Use this action when you need to get all options from a dropdown.',
        async ({ index, browser }: { index: number, browser: Browser }): Promise<ActionResult> => {
            try {
                // Get the page and element information
                const page = await browser.getCurrentPage();
                const interactiveElements = browser.getState().interactive_elements;
                
                // Verify the element exists and is a select
                if (!(index in interactiveElements)) {
                    return { error: `No element found with index ${index}` };
                }
                
                const element = interactiveElements[index];
                
                // Check if it's a select element
                if (element.tag_name.toLowerCase() !== 'select') {
                    return { 
                        error: `Element ${index} is not a select element, it's a ${element.tag_name}` 
                    };
                }
                
                // Use the unique ID to find the element
                const optionsData = await page.evaluate(({ browserAgentId }: { browserAgentId: string }) => {
                    // Find the select element using the unique ID
                    const select = document.querySelector(`[data-browser-agent-id="${browserAgentId}"]`);
                    if (!select) return null;
                    
                    // Get all options
                    return {
                        options: Array.from((select as HTMLSelectElement).options).map(opt => ({
                            text: opt.text,
                            value: opt.value,
                            index: opt.index
                        })),
                        id: (select as HTMLSelectElement).id,
                        name: (select as HTMLSelectElement).name
                    };
                }, { browserAgentId: element.browser_agent_id });
                
                if (!optionsData) {
                    return { error: 'Failed to retrieve dropdown options' };
                }
                
                // Process options from direct approach
                const formattedOptions: string[] = [];
                for (const opt of optionsData.options) {
                    const encodedText = JSON.stringify(opt.text);
                    formattedOptions.push(`${opt.index}: option=${encodedText}`);
                }
                
                let msg = formattedOptions.join('\n');
                msg += '\nIf you decide to use this select element, use the exact option name in select_dropdown_option';
                
                console.log(`Found dropdown with ID: ${optionsData.id}, Name: ${optionsData.name}`);
                return { content: msg };
            } catch (e) {
                console.error(`Failed to get dropdown options: ${e}`);
                return { error: `Error getting dropdown options: ${e}` };
            }
        },
        true
    );
    
    controller.registerAction(
        'select_dropdown_option',
        'Select an option from a <select> element by the text (name) of the option. Use this after get_select_options and when you need to select an option from a dropdown.',
        async ({ index, option, browser }: { index: number, option: string, browser: Browser }): Promise<ActionResult> => {
            try {
                // Get the interactive element
                const page = await browser.getCurrentPage();
                const interactiveElements = browser.getState().interactive_elements;
                
                // Verify the element exists and is a select
                if (!(index in interactiveElements)) {
                    return { error: `No element found with index ${index}` };
                }
                
                const element = interactiveElements[index];
                
                // Check if it's a select element
                if (element.tag_name.toLowerCase() !== 'select') {
                    return { 
                        error: `Element ${index} is not a select element, it's a ${element.tag_name}` 
                    };
                }
                
                console.log(`Attempting to select '${option}' using browser_agent_id: ${element.browser_agent_id}`);
                
                // Use JavaScript to select the option using the unique ID
                const result = await page.evaluate(({ uniqueId, optionText }: { uniqueId: string, optionText: string }) => {
                    try {
                        // Find the select element by unique ID - works across frames too
                        function findElementByUniqueId(id: string): HTMLSelectElement | null {
                            // Check in main document first
                            let element = document.querySelector(`[data-browser-agent-id="${id}"]`);
                            if (element) return element as HTMLSelectElement;
                            return null;
                        }
                        
                        const select = findElementByUniqueId(uniqueId);
                        if (!select) {
                            return { 
                                success: false, 
                                error: `Select element not found with ID: ${uniqueId}`
                            };
                        }
                        
                        // Find the option with matching text
                        let found = false;
                        let selectedValue = null;
                        let selectedIndex = -1;
                        
                        for (let i = 0; i < select.options.length; i++) {
                            const opt = select.options[i];
                            if (opt.text === optionText) {
                                // Select this option
                                opt.selected = true;
                                found = true;
                                selectedValue = opt.value;
                                selectedIndex = i;
                                
                                // Trigger change event
                                const event = new Event('change', { bubbles: true });
                                select.dispatchEvent(event);
                                break;
                            }
                        }
                        
                        if (found) {
                            return { 
                                success: true, 
                                value: selectedValue, 
                                index: selectedIndex 
                            };
                        } else {
                            return { 
                                success: false, 
                                error: `Option not found: ${optionText}`,
                                availableOptions: Array.from(select.options).map(o => o.text)
                            };
                        }
                    } catch (e) {
                        return { 
                            success: false, 
                            error: e instanceof Error ? e.message : String(e)
                        };
                    }
                }, { uniqueId: element.browser_agent_id, optionText: option });
                
                if (result.success) {
                    const msg = `Selected option '${option}' with value '${result.value}' at index ${result.index}`;
                    console.log(msg);
                    return { content: msg };
                } else {
                    let errorMsg = result.error || 'Unknown error';
                    if ('availableOptions' in result) {
                        const available = result.availableOptions || [];
                        errorMsg += `. Available options: ${available.join(', ')}`;
                    }
                    
                    console.error(`Selection failed: ${errorMsg}`);
                    return { error: errorMsg };
                }
            } catch (e) {
                const msg = `Selection failed: ${e}`;
                console.error(msg);
                return { error: msg };
            }
        },
        true
    );
}
