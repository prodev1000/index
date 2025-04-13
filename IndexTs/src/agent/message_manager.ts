// src/agent/message_manager.ts
import { Message, MessageRole, createImageMessage, createTextMessage } from '@/llm/llm';
import { BrowserState } from '@/browser/models';
import { ActionResult } from '@/controller/models';
import { AgentLLMOutput } from './models';
import { systemMessage } from './prompts';
import { loadDemoImageAsB64 } from './utils';
import { scaleB64Image } from '@/browser/utils';

export class MessageManager {
    private messages: Message[] = [];
    private actionDescriptions: string;

    constructor(actionDescriptions: string) {
        this.actionDescriptions = actionDescriptions;
    }

    /**
     * Initialize the conversation with system message and user prompt
     * 
     * @param userPrompt - User's task description
     */
    async addSystemMessageAndUserPrompt(userPrompt: string): Promise<void> {
        // Add system message with action descriptions
        const system = createTextMessage(
            MessageRole.SYSTEM,
            systemMessage(this.actionDescriptions)
        );
        this.messages.push(system);

        // Add user prompt with demo images for context
        // Load demo images
        const complexLayoutHighlight = await loadDemoImageAsB64('complex_layout_highlight.png');
        const complexLayoutClean = await loadDemoImageAsB64('complex_layout_clean.png'); 
        const complexLayoutSmallElements = await loadDemoImageAsB64('complex_layout_small_elements.png');
        const loading = await loadDemoImageAsB64('loading.png');
        const scroll = await loadDemoImageAsB64('scroll.png');
        
        // Create user message with images
        const userMessage: Message = {
            role: MessageRole.USER,
            content: [
                {
                    type: 'text',
                    text: userPrompt
                },
                {
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: 'image/png',
                        data: complexLayoutHighlight
                    }
                },
                {
                    type: 'text',
                    text: "This is an example of highlighted elements on a complex layout. Notice the bounding boxes and labels."
                },
                {
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: 'image/png',
                        data: complexLayoutClean
                    }
                },
                {
                    type: 'text',
                    text: "This is the same page but without highlights, to help you better understand the layout."
                },
                {
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: 'image/png',
                        data: complexLayoutSmallElements
                    }
                },
                {
                    type: 'text',
                    text: "This shows a page with many small elements, like this navigation menu. You need to be precise in identifying the correct elements."
                },
                {
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: 'image/png',
                        data: loading
                    }
                },
                {
                    type: 'text',
                    text: "This is an example of a loading page. If you see something like this, use wait_for_page_to_load action."
                },
                {
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: 'image/png',
                        data: scroll
                    }
                },
                {
                    type: 'text',
                    text: "This shows a page with a scrollable element (notice the scrollbar). Use scroll_down_over_element with an element ID inside the scrollable area."
                }
            ]
        };
        this.messages.push(userMessage);
    }

    /**
     * Add a message representing the current state of the browser
     * 
     * @param state - Current browser state
     * @param previousActionResult - Result of the previous action (if any)
     */
    async addCurrentStateMessage(state: BrowserState, previousActionResult?: ActionResult): Promise<void> {
        let stateDescription = '';

        // Add previous action info if available
        if (previousActionResult) {
            if (previousActionResult.error) {
                stateDescription += `Previous action failed with error: ${previousActionResult.error}\n\n`;
            } else if (previousActionResult.content) {
                stateDescription += `Previous action result: ${previousActionResult.content}\n\n`;
            }
        }

        // Current URL and tabs info
        stateDescription += `Current URL: ${state.url}\n\n`;
        
        if (state.tabs && state.tabs.length > 0) {
            stateDescription += "Open tabs:\n";
            for (const tab of state.tabs) {
                stateDescription += `- Tab ${tab.page_id}: ${tab.title} (${tab.url})\n`;
            }
            stateDescription += '\n';
        }

        // Interactive elements description
        if (Object.keys(state.interactive_elements).length > 0) {
            stateDescription += "Available elements:\n";
            Object.keys(state.interactive_elements).forEach((indexStr) => {
                const index = parseInt(indexStr);
                const element = state.interactive_elements[index];
                let text = element.text || '';
                // Truncate very long texts
                if (text.length > 50) {
                    text = text.substring(0, 47) + '...';
                }
                stateDescription += `[${index}]<${element.tag_name}>${text}</${element.tag_name}>\n`;
            });
            stateDescription += '\n';
        } else {
            stateDescription += "No interactive elements detected.\n\n";
        }

        // Scroll information
        if (state.viewport) {
            const vp = state.viewport;
            let scrollInfo = '';
            
            if (vp.scroll_distance_above_viewport > 0) {
                scrollInfo += `- Can scroll up by ${vp.scroll_distance_above_viewport} pixels\n`;
            }
            if (vp.scroll_distance_below_viewport > 0) {
                scrollInfo += `- Can scroll down by ${vp.scroll_distance_below_viewport} pixels\n`;
            }
            
            if (scrollInfo) {
                stateDescription += "Scroll information:\n" + scrollInfo + '\n';
            }
        }

        // Create the message with both screenshots (clean and highlighted)
        const message: Message = {
            role: MessageRole.USER,
            content: [
                {
                    type: 'text',
                    text: stateDescription
                }
            ]
        };

        // Add clean screenshot if available
        if (state.screenshot) {
            message.content.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: state.screenshot
                }
            });
            message.content.push({
                type: 'text',
                text: '<current_state_clean_screenshot>'
            });
        }

        // Add screenshot with highlights if available
        if (state.screenshot_with_highlights) {
            message.content.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: state.screenshot_with_highlights
                }
            });
            message.content.push({
                type: 'text',
                text: '<current_state>'
            });
        }

        this.messages.push(message);
    }

    /**
     * Add the LLM's response and the state before the action
     * 
     * @param modelOutput - LLM's parsed response
     * @param stateScreenshot - Screenshot of the state before the action
     * @param thinking - Optional thinking block from the LLM
     */
    async addMessageFromModelOutput(
        modelOutput: AgentLLMOutput,
        stateScreenshot?: string,
        thinking?: any
    ): Promise<void> {
        // Remove all images from previous state messages to conserve context space
        for (let i = 0; i < this.messages.length; i++) {
            const msg = this.messages[i];
            if (msg.role === MessageRole.USER && msg.is_state_message && Array.isArray(msg.content)) {
                // Keep only the text content, remove images
                const textContents = msg.content.filter(c => c.type === 'text');
                msg.content = textContents;
            }
        }

        // Format the output as JSON within <output_step> tags
        const outputJson = JSON.stringify({
            thought: modelOutput.thought,
            action: modelOutput.action,
            summary: modelOutput.summary || ''
        }, null, 2);

        // Create assistant message with thinking if available
        const assistantMessage: Message = {
            role: MessageRole.ASSISTANT,
            content: [
                {
                    type: 'text',
                    text: `<output_step>\n${outputJson}\n</output_step>`
                }
            ]
        };

        // Add thinking block if available
        if (thinking) {
            assistantMessage.content.unshift({
                type: 'thinking',
                thinking: thinking.thinking,
                signature: thinking.signature
            });
        }

        this.messages.push(assistantMessage);

        // Add state message with screenshot if available
        if (stateScreenshot) {
            // Scale down the screenshot to save tokens
            const scaledStateScreenshot = await scaleB64Image(stateScreenshot, 0.6);
            
            const stateMessage: Message = {
                role: MessageRole.USER,
                is_state_message: true,
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: 'image/png',
                            data: scaledStateScreenshot
                        },
                        cache_control: true
                    },
                    {
                        type: 'text',
                        text: '<state_step>'
                    }
                ]
            };
            this.messages.push(stateMessage);
        }
    }

    /**
     * Get all messages for sending to the LLM
     */
    getMessages(): Message[] {
        // Make a copy of messages to avoid modifying the original array
        const messagesToSend = [...this.messages];
        
        // Ensure that only the last state message has cache_control
        let lastStateMessageIndex = -1;
        for (let i = messagesToSend.length - 1; i >= 0; i--) {
            const msg = messagesToSend[i];
            if (msg.is_state_message && Array.isArray(msg.content) && msg.content.length > 0) {
                if (lastStateMessageIndex === -1) {
                    lastStateMessageIndex = i;
                    // Keep cache_control for the last state message
                    continue;
                }
                
                // Remove cache_control from earlier state messages
                msg.content = msg.content.map(c => ({
                    ...c,
                    cache_control: undefined
                }));
            }
        }
        
        return messagesToSend;
    }

    /**
     * Set the messages array (used for loading from a saved state)
     * 
     * @param messages - Array of messages to set
     */
    setMessages(messages: Message[]): void {
        this.messages = messages;
    }
}
