import pino from "pino";
import { v4 as uuidv4 } from "uuid";

import { MessageManager } from "./message_manager.js";
import {
  ActionResult,
  AgentLLMOutput,
  AgentOutput,
  AgentState,
  AgentStreamChunk,
  FinalOutputChunk,
  StepChunk,
  StepChunkContent,
  StepChunkError,
  TimeoutChunk,
  TimeoutChunkContent,
} from "./models.js";

import { Browser, BrowserConfig } from "../browser/browser.js";
import { Controller } from "../controller/controller.js";
import { BaseLLMProvider, Message } from "../llm/llm.js";

const logger = pino({ name: "agent" });

/**
 * Agent class that coordinates interactions between LLM, browser and controller
 */
export class Agent {
  private llm: BaseLLMProvider;
  private controller: Controller;
  private browser: Browser;
  private messageManager: MessageManager;
  private state: AgentState;
  private finalOutput?: string;

  /**
   * Initialize the agent with LLM provider and browser configuration
   * @param llm - The LLM provider implementation to use
   * @param browserConfig - Optional browser configuration
   */
  constructor(llm: BaseLLMProvider, browserConfig?: BrowserConfig) {
    this.llm = llm;
    this.controller = new Controller();

    // Initialize browser with provided config or default
    this.browser = new Browser(browserConfig || {});

    const actionDescriptions = this.controller.getActionDescriptions();

    this.messageManager = new MessageManager(actionDescriptions);

    this.state = new AgentState({
      messages: [],
    });
  }

  /**
   * Execute one step of the task
   * @param step - The current step number
   * @param previousResult - Optional result from previous action
   * @param stepSpanContext - Optional span context for tracing
   * @returns Tuple of action result and summary
   */
  async step(
    step: number,
    previousResult?: ActionResult | null,
    stepSpanContext?: any
  ): Promise<[ActionResult, string]> {
    // Note: We're omitting the span context handling since we're not implementing Laminar

    // Update the browser state
    const state = await this.browser.updateState();

    if (previousResult) {
      this.messageManager.addCurrentStateMessage(state, previousResult);
    }

    const inputMessages = this.messageManager.getMessages();

    try {
      // Generate the next action using the LLM
      const modelOutput = await this._generateAction(inputMessages);

      if (previousResult) {
        // Remove the state message we just added because we want to append it in a different format
        this.messageManager.removeLastMessage();
      }

      // Add the model output as a message
      this.messageManager.addMessageFromModelOutput(
        step,
        previousResult || null,
        modelOutput,
        state.screenshot
      );

      try {
        // Execute the action
        const result = await this.controller.executeAction(
          modelOutput.action,
          this.browser
        );

        if (result.isDone) {
          logger.info(`Result: ${result.content}`);
          this.finalOutput = result.content;
        }

        return [result, modelOutput.summary];
      } catch (error) {
        throw error;
      }
    } catch (error) {
      // Model call failed, remove last state message from history before retrying
      this.messageManager.removeLastMessage();
      throw error;
    }
  }

  /**
   * Generate the next action using the LLM
   * @param inputMessages - List of input messages for the LLM
   * @returns The LLM's output with action to take
   */
  private async _generateAction(
    inputMessages: Message[]
  ): Promise<AgentLLMOutput> {
    const response = await this.llm.call(inputMessages);

    // Clean null characters from response
    let content = response.content.replace(/\0/g, "");

    // Extract content between <output> tags using regex, including variations like <output_32>
    const pattern = /<output(?:[^>]*)>(.*?)<\/output(?:[^>]*)>/s;
    const match = pattern.exec(content);

    let jsonStr = "";

    if (!match) {
      // If we couldn't find the <output> tags, assume the whole content is the JSON
      jsonStr = content.replace(/<o>/g, "").replace(/<\/o>/g, "").trim();
    } else {
      // Extract the content from within the <output> tags
      jsonStr = match[1].replace(/<o>/g, "").replace(/<\/o>/g, "").trim();
    }

    try {
      // First try to parse it directly
      try {
        JSON.parse(jsonStr);
      } catch (jsonError) {
        // If direct parsing fails, attempt to fix common issues
        jsonStr = jsonStr
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t");
      }

      // Parse the JSON into an AgentLLMOutput
      const outputObj = JSON.parse(jsonStr);

      // Validate required fields
      if (!outputObj.thought) {
        throw new Error("Missing required field 'thought'");
      }

      if (!outputObj.action || !outputObj.action.name) {
        throw new Error("Missing required field 'action.name'");
      }

      const output = new AgentLLMOutput({
        thought: outputObj.thought,
        action: {
          name: outputObj.action.name,
          params: outputObj.action.params || {},
        },
        summary: outputObj.summary || "",
        thinkingBlock: response.thinking,
      });

      logger.info(`💡 Thought: ${output.thought}`);
      logger.info(`💡 Summary: ${output.summary}`);
      logger.info(`🛠️ Action: ${JSON.stringify(output.action)}`);

      return output;
    } catch (error) {
      throw new Error(
        `Could not parse response: ${error}\nResponse was: ${jsonStr}`
      );
    }
  }

  /**
   * Set up messages based on state or initialize with system message
   * @param prompt - Optional user prompt
   * @param agentState - Optional serialized agent state
   */
  private async _setupMessages(
    prompt?: string | null,
    agentState?: string | null
  ): Promise<void> {
    if (!prompt && !agentState) {
      throw new Error("Either prompt or agentState must be provided");
    }

    if (agentState) {
      try {
        // Parse the state and restore messages
        const state = AgentState.fromJSON(agentState);
        this.messageManager.setMessages(state.messages);

        // Update browser state
        const browserState = await this.browser.updateState();

        // Add current state message with optional user follow-up
        if (prompt) {
          // Add the state with user follow-up message if prompt is provided
          this.messageManager.addCurrentStateMessage(
            browserState,
            null,
            prompt
          );
        } else {
          // Just update the state message without user follow-up
          this.messageManager.addCurrentStateMessage(browserState);
        }
      } catch (error) {
        logger.error(`Failed to restore agent state: ${error}`);
        throw new Error(`Invalid agent state: ${error}`);
      }
    } else if (prompt) {
      // Add system message and user prompt to start a new conversation
      this.messageManager.addSystemMessageAndUserPrompt(prompt);

      // Initialize browser and get its state
      try {
        await this.browser.updateState();
      } catch (error) {
        logger.error(`Failed to initialize browser state: ${error}`);
      }
    }
  }

  /**
   * Run the agent to complete a task
   * @param prompt - Optional user prompt
   * @param maxSteps - Maximum number of steps to execute
   * @param agentState - Optional serialized agent state
   * @param parentSpanContext - Optional parent span context for tracing
   * @param closeContext - Whether to close the browser context after completion
   * @param prevActionResult - Optional previous action result
   * @param sessionId - Optional session ID
   * @returns The final agent output
   */
  async run(
    options: {
      prompt?: string | null;
      maxSteps?: number;
      agentState?: string | null;
      parentSpanContext?: any;
      closeContext?: boolean;
      prevActionResult?: ActionResult | null;
      sessionId?: string | null;
    } = {}
  ): Promise<AgentOutput> {
    const {
      prompt = null,
      maxSteps = 100,
      agentState = null,
      parentSpanContext = null,
      closeContext = true,
      prevActionResult = null,
      sessionId = null,
    } = options;

    if (prompt === null && agentState === null) {
      throw new Error("Either prompt or agentState must be provided");
    }

    // Note: We're omitting the span context handling since we're not implementing Laminar

    // Set up the initial messages
    await this._setupMessages(prompt, agentState);

    let step = 0;
    let result: ActionResult | null = prevActionResult;
    let isDone = false;

    // Generate a trace ID for this run
    const traceId = uuidv4();

    try {
      // Main execution loop
      while (!isDone && step < maxSteps) {
        logger.info(`📍 Step ${step}`);

        [result /* summary */] = await this.step(step, result);
        step += 1;
        isDone = result.isDone;

        if (isDone) {
          logger.info(`✅ Task completed successfully in ${step} steps`);
          break;
        }
      }

      if (!isDone) {
        logger.info("❌ Maximum number of steps reached");
      }
    } catch (error) {
      logger.error(`❌ Error in run: ${error}`);
    } finally {
      // Get browser storage state
      const storageState = await this.browser.getStorageState();

      if (closeContext) {
        // Close the browser
        await this.browser.close();
      }

      // Return the final output
      return new AgentOutput({
        agentState: this.getState(),
        result,
        storageState,
        stepCount: step,
        traceId,
      });
    }
  }

  /**
   * Run the agent and stream results as they happen
   * @param options - Configuration options for the streaming run
   * @yields Agent stream chunks
   */
  async *runStream(
    options: {
      prompt?: string | null;
      maxSteps?: number;
      agentState?: string | null;
      parentSpanContext?: any;
      closeContext?: boolean;
      prevActionResult?: ActionResult | null;
      prevStep?: number | null;
      stepSpanContext?: any;
      timeout?: number | null;
      sessionId?: string | null;
      returnScreenshots?: boolean;
    } = {}
  ): AsyncGenerator<AgentStreamChunk, void, unknown> {
    const {
      prompt = null,
      maxSteps = 100,
      agentState = null,
      parentSpanContext = null,
      closeContext = true,
      prevActionResult = null,
      prevStep = null,
      stepSpanContext = null,
      timeout = null,
      sessionId = null,
      returnScreenshots = false,
    } = options;

    if (prompt === null && agentState === null) {
      throw new Error("Either prompt or agentState must be provided");
    }

    if (
      prevStep !== null &&
      (prevActionResult === null || prevStep === 0 || agentState === null)
    ) {
      throw new Error(
        "`prevActionResult` and `agentState` must be provided if `prevStep` is provided"
      );
    }

    // Generate a trace ID for this run
    const traceId = uuidv4();

    // Set up the initial messages
    await this._setupMessages(prompt, agentState);

    let step = prevStep !== null ? prevStep : 0;
    let result: ActionResult | null = prevActionResult;
    let isDone = false;

    let startTime: number | null = null;
    if (timeout !== null) {
      startTime = Date.now();
    }

    try {
      // Main execution loop
      while (!isDone && step < maxSteps) {
        logger.info(`📍 Step ${step}`);

        // Execute the next step
        const [stepResult, summary] = await this.step(
          step,
          result,
          stepSpanContext
        );
        result = stepResult;
        step += 1;
        isDone = result.isDone;

        // Get screenshot if requested
        let screenshot: string | null = null;
        if (returnScreenshots) {
          const state = this.browser.getState();
          screenshot = state.screenshot;
        }

        // Check timeout
        if (
          timeout !== null &&
          startTime !== null &&
          Date.now() - startTime > timeout
        ) {
          // Yield timeout chunk and return
          yield new TimeoutChunk({
            content: new TimeoutChunkContent({
              actionResult: result,
              summary,
              step,
              agentState: this.getState(),
              stepParentSpanContext: stepSpanContext
                ? JSON.stringify(stepSpanContext)
                : undefined,
              traceId,
              screenshot,
            }),
          });
          return;
        }

        // Yield step result
        yield new StepChunk({
          content: new StepChunkContent({
            actionResult: result,
            summary,
            traceId,
            screenshot,
          }),
        });

        if (isDone) {
          logger.info(`✅ Task completed successfully in ${step} steps`);
          break;
        }
      }

      if (!isDone) {
        logger.info("❌ Maximum number of steps reached");
        yield new StepChunkError({
          content: `Maximum number of steps reached: ${maxSteps}`,
        });
      }
    } catch (error) {
      logger.error(`❌ Error in run: ${error}`);
    } finally {
      try {
        // Get browser storage state
        const storageState = await this.browser.getStorageState();

        if (closeContext) {
          // Close the browser
          await this.browser.close();
        }

        // Yield the final output
        const finalOutput = new AgentOutput({
          agentState: this.getState(),
          result,
          storageState,
          stepCount: step,
          traceId,
        });

        yield new FinalOutputChunk({ content: finalOutput });
      } finally {
        logger.info("Stream complete");
      }
    }
  }

  /**
   * Get the current agent state
   * @returns AgentState object
   */
  getState(): AgentState {
    this.state.messages = this.messageManager.getMessages();
    return this.state;
  }
}
