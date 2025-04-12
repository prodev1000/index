import pino from "pino";
import { get } from "lodash";
import dayjs from "dayjs";
import { ActionResult, AgentLLMOutput } from "./models.js";
import { systemMessage } from "./prompts.js";
import { loadDemoImageAsB64 } from "./utils.js";
import { BrowserState } from "../browser/models.js";
import { scaleB64Image } from "../browser/utils.js";
import { ImageContent, Message, TextContent } from "../llm/llm.js";

const logger = pino({ name: "message_manager" });

/**
 * Manages messages for the agent's conversation with the LLM
 */
export class MessageManager {
  private _messages: Message[] = [];
  private actionDescriptions: string;

  /**
   * Initialize the message manager
   * @param actionDescriptions - Description of available actions for the agent
   */
  constructor(actionDescriptions: string) {
    this._messages = [];
    this.actionDescriptions = actionDescriptions;
  }

  /**
   * Add system message and user prompt to start a conversation
   * @param prompt - The user's task prompt
   */
  addSystemMessageAndUserPrompt(prompt: string): void {
    const complexLayoutHighlight = loadDemoImageAsB64(
      "complex_layout_highlight.png"
    );
    const complexLayoutSmallElements = loadDemoImageAsB64(
      "complex_layout_small_elements.png"
    );
    const stillLoading = loadDemoImageAsB64("loading.png");
    const stillLoading2 = loadDemoImageAsB64("loading2.png");
    const scrollOverElementExample = loadDemoImageAsB64("scroll.png");

    const systemMsg: Message = {
      role: "system",
      content: [
        {
          type: "text",
          text: systemMessage(this.actionDescriptions),
          cacheControl: true,
        },
      ],
    };

    this._messages.push(systemMsg);

    this._messages.push({
      role: "user",
      content: [
        { type: "text", text: "<complex_layout_example>" },
        {
          type: "text",
          text: "Here's an example of a complex layout. As an example, if you want to select a 'Roster' section for Colorado Rockies. Then you need to click on element with index 121.",
        },
        { type: "image", imageUrl: "", imageB64: complexLayoutHighlight },
        { type: "text", text: "</complex_layout_example>" },
        { type: "text", text: "<small_elements_example>" },
        {
          type: "text",
          text: "Here's an example of small elements on the page and their functions. Element 7, represented by 'x' icon, is a 'clear text' button. Element 8 is a 'submit' button, represented by '=' icon. This clarification should help you better understand similar web pages.",
        },
        { type: "image", imageUrl: "", imageB64: complexLayoutSmallElements },
        { type: "text", text: "</small_elements_example>" },
        { type: "text", text: "<loading_pages_example>" },
        {
          type: "text",
          text: "Here are some examples of loading pages. If the main content on the page is empty or if there are loading elements, such as skeleton screens, page is still loading. Then, you HAVE to perform `wait_for_page_to_load` action.",
        },
        { type: "image", imageUrl: "", imageB64: stillLoading },
        { type: "image", imageUrl: "", imageB64: stillLoading2 },
        { type: "text", text: "</loading_pages_example>" },
        { type: "text", text: "<scroll_over_element_example>" },
        {
          type: "text",
          text: "In some cases, to reveal more content, you need to scroll in scrollable areas of the webpage. Scrollable areas have VERTICAL scrollbars very clearly visible on their right side. In the screenshot below, you can clearly see a scrollbar on the right side of the list of search items. This indicates that the list is scrollable. To scroll over this area, you need to identify any element within the scrollable area and use its index with `scroll_down_over_element` action to scroll over it. In this example, approriate element is with index 15.",
        },
        { type: "image", imageUrl: "", imageB64: scrollOverElementExample },
        {
          type: "text",
          text: "</scroll_over_element_example>",
          cacheControl: true,
        },
        {
          type: "text",
          text: `Here is the task you need to complete:\n\n<task>\n${prompt}\n</task>\n\nToday's date and time is: ${dayjs().format(
            "MMMM DD, YYYY, hh:mmA"
          )} - keep this date and time in mind when planning your actions.`,
        },
      ],
    });
  }

  /**
   * Get messages marked as state messages
   * @returns List of state messages
   */
  getMessagesAsState(): Message[] {
    return this._messages.filter((msg) => msg.isStateMessage === true);
  }

  /**
   * Remove the last message from the history
   */
  removeLastMessage(): void {
    if (this._messages.length > 1) {
      this._messages.pop();
    }
  }

  /**
   * Add current browser state as a user message
   * @param state - The current browser state
   * @param previousResult - Optional result from previous action
   * @param userFollowUpMessage - Optional follow-up message from the user
   */
  addCurrentStateMessage(
    state: BrowserState,
    previousResult: ActionResult | null = null,
    userFollowUpMessage: string | null = null
  ): void {
    let highlightedElements = "";

    if (state.interactiveElements) {
      // Convert interactiveElements from Record to array
      const elements = Object.values(state.interactiveElements);

      for (const element of elements) {
        // Exclude sheets elements
        if (
          element.browserAgentId.startsWith("row_") ||
          element.browserAgentId.startsWith("column_")
        ) {
          continue;
        }

        let startTag = `[${element.index}]<${element.tagName}`;

        if (element.inputType) {
          startTag += ` type="${element.inputType}"`;
        }

        startTag += ">";

        highlightedElements += `${startTag}${element.text.replace(
          "\n",
          " "
        )}</${element.tagName}>\n`;
      }
    }

    const scrollDistanceAboveViewport =
      state.viewport.scrollDistanceAboveViewport || 0;
    const scrollDistanceBelowViewport =
      state.viewport.scrollDistanceBelowViewport || 0;

    let elementsText =
      scrollDistanceAboveViewport > 0
        ? `${scrollDistanceAboveViewport}px scroll distance above current viewport\n`
        : "[Start of page]\n";

    if (highlightedElements !== "") {
      elementsText += `\nHighlighted elements:\n${highlightedElements}`;
    }

    if (scrollDistanceBelowViewport > 0) {
      elementsText += `\n${scrollDistanceBelowViewport}px scroll distance below current viewport\n`;
    } else {
      elementsText += "\n[End of page]";
    }

    let previousActionOutput = "";
    if (previousResult) {
      if (previousResult.content) {
        previousActionOutput = `<previous_action_output>\n${previousResult.content}\n</previous_action_output>\n\n`;
      }

      if (previousResult.error) {
        previousActionOutput += `<previous_action_error>\n${previousResult.error}\n</previous_action_error>\n\n`;
      }
    }

    const userFollowUp = userFollowUpMessage
      ? `<user_follow_up_message>\n${userFollowUpMessage}\n</user_follow_up_message>\n\n`
      : "";

    const tabsInfo = state.tabs
      .map((tab) => `Tab ${tab.pageId}: ${tab.title} (${tab.url})`)
      .join("\n");

    const stateDescription = `${previousActionOutput}${userFollowUp}
<viewport>
Current URL: ${state.url}

Open tabs:
${tabsInfo}

Current viewport information:
${elementsText}
</viewport>`;

    const stateMsg: Message = {
      role: "user",
      content: [
        { type: "text", text: stateDescription },
        { type: "text", text: "<current_state_clean_screenshot>" },
        { type: "image", imageUrl: "", imageB64: state.screenshot || "" },
        { type: "text", text: "</current_state_clean_screenshot>" },
        { type: "text", text: "<current_state>" },
        {
          type: "image",
          imageUrl: "",
          imageB64: state.screenshotWithHighlights || "",
        },
        { type: "text", text: "</current_state>" },
      ],
    };

    this._messages.push(stateMsg);
  }

  /**
   * Add model output as AI message
   * @param step - The current step number
   * @param previousResult - Result from previous action
   * @param modelOutput - The model's output
   * @param screenshot - Optional screenshot to include
   */
  addMessageFromModelOutput(
    step: number,
    previousResult: ActionResult | null,
    modelOutput: AgentLLMOutput,
    screenshot: string | null = null
  ): void {
    // Reset content for state messages to just the first entry
    for (const msg of this._messages) {
      if (msg.isStateMessage && msg.content.length > 1) {
        msg.content = [msg.content[0]];
      }
    }

    let previousActionOutput = "";

    if (previousResult && screenshot) {
      if (previousResult.content) {
        previousActionOutput = `<action_output_${step - 1}>\n${
          previousResult.content
        }\n</action_output_${step - 1}>`;
      }

      if (previousResult.error) {
        previousActionOutput += `<action_error_${step - 1}>\n${
          previousResult.error
        }\n</action_error_${step - 1}>`;
      }

      const userMsg: Message = {
        role: "user",
        content: [
          { type: "text", text: previousActionOutput, cacheControl: true },
          { type: "text", text: `<state_${step}>` },
          {
            type: "image",
            imageUrl: "",
            imageB64: screenshot ? scaleB64Image(screenshot, 0.75) : "",
          },
          { type: "text", text: `</state_${step}>` },
        ],
        isStateMessage: true,
      };

      this._messages.push(userMsg);
    }

    // Create assistant content with model output
    const assistantContent: (TextContent | ImageContent | ThinkingBlock)[] = [];

    // Add thinking block if available
    if (modelOutput.thinkingBlock) {
      assistantContent.push(modelOutput.thinkingBlock);
    }

    // Add model output as JSON
    assistantContent.push({
      type: "text",
      text: `<output_${step}>
${JSON.stringify(
  {
    thought: modelOutput.thought,
    action: {
      name: modelOutput.action.name,
      params: modelOutput.action.params,
    },
    summary: modelOutput.summary,
  },
  null,
  2
).trim()}
</output_${step}>`,
    });

    const msg = new Message("assistant", assistantContent);

    this._messages.push(msg);
  }

  /**
   * Get all messages for the conversation
   * @returns List of messages
   */
  getMessages(): Message[] {
    let foundFirstCacheControl = false;

    // Clear all past cache control except the latest one
    for (let i = this._messages.length - 1; i >= 0; i--) {
      const msg = this._messages[i];

      // Ignore system messages
      if (msg.role === "system") {
        continue;
      }

      if (foundFirstCacheControl) {
        this.removeCacheControl(msg);
      }

      if (this.hasCacheControl(msg)) {
        foundFirstCacheControl = true;
      }
    }

    return this._messages;
  }

  /**
   * Set messages for the conversation
   * @param messages - List of messages
   */
  setMessages(messages: Message[]): void {
    this._messages = messages;
  }

  /**
   * Check if a message has cache control
   * @param message - The message to check
   * @returns True if the message has cache control
   */
  private hasCacheControl(message: Message): boolean {
    return message.content.some(
      (content) =>
        content.type === "text" &&
        "cacheControl" in content &&
        content.cacheControl === true
    );
  }

  /**
   * Remove cache control from a message
   * @param message - The message to modify
   */
  private removeCacheControl(message: Message): void {
    message.content.forEach((content) => {
      if (content.type === "text" && "cacheControl" in content) {
        content.cacheControl = false;
      }
    });
  }
}
