import { z } from "zod";
import { Message, ThinkingBlock } from "../llm/llm.js";

// Define Zod schemas for validation (equivalent to Pydantic models)
export const AgentStateSchema = z.object({
  messages: z.array(z.any()), // Will be properly typed once Message is defined in llm/llm.ts
});

export const ActionResultSchema = z.object({
  isDone: z.boolean().optional().default(false),
  content: z.string().optional(),
  error: z.string().optional(),
  giveControl: z.boolean().optional().default(false),
});

export const ActionModelSchema = z.object({
  name: z.string(),
  params: z.record(z.any()),
});

export const AgentLLMOutputSchema = z.object({
  thought: z.string(),
  action: ActionModelSchema,
  summary: z.string().optional(),
  thinkingBlock: z.any().optional(), // Will be properly typed once ThinkingBlock is defined
});

export const AgentOutputSchema = z.object({
  agentState: z.any(), // AgentStateSchema,
  result: ActionResultSchema.nullable(),
  stepCount: z.number().int().default(0),
  storageState: z.any().optional(), // Placeholder for PlaywrightJS StorageState
  traceId: z.string().nullable().default(null),
});

// Base schema for stream chunks
export const AgentStreamChunkSchema = z.object({
  type: z.string(),
});

export const StepChunkContentSchema = z.object({
  actionResult: ActionResultSchema,
  summary: z.string(),
  traceId: z.string().nullable().default(null),
  screenshot: z.string().optional(),
});

export const StepChunkSchema = AgentStreamChunkSchema.extend({
  type: z.literal("step"),
  content: StepChunkContentSchema,
});

export const TimeoutChunkContentSchema = z.object({
  actionResult: ActionResultSchema,
  summary: z.string(),
  step: z.number().int(),
  agentState: z.any(), // AgentStateSchema,
  stepParentSpanContext: z.string().optional(),
  traceId: z.string().nullable().default(null),
  screenshot: z.string().optional(),
});

export const TimeoutChunkSchema = AgentStreamChunkSchema.extend({
  type: z.literal("step_timeout"),
  content: TimeoutChunkContentSchema,
});

export const StepChunkErrorSchema = AgentStreamChunkSchema.extend({
  type: z.literal("step_error"),
  content: z.string(),
});

export const FinalOutputChunkSchema = AgentStreamChunkSchema.extend({
  type: z.literal("final_output"),
  content: AgentOutputSchema,
});

// TypeScript types derived from Zod schemas
export type AgentStateType = z.infer<typeof AgentStateSchema>;
export type ActionResultType = z.infer<typeof ActionResultSchema>;
export type ActionModelType = z.infer<typeof ActionModelSchema>;
export type AgentLLMOutputType = z.infer<typeof AgentLLMOutputSchema>;
export type AgentOutputType = z.infer<typeof AgentOutputSchema>;
export type AgentStreamChunkType = z.infer<typeof AgentStreamChunkSchema>;
export type StepChunkContentType = z.infer<typeof StepChunkContentSchema>;
export type StepChunkType = z.infer<typeof StepChunkSchema>;
export type TimeoutChunkContentType = z.infer<typeof TimeoutChunkContentSchema>;
export type TimeoutChunkType = z.infer<typeof TimeoutChunkSchema>;
export type StepChunkErrorType = z.infer<typeof StepChunkErrorSchema>;
export type FinalOutputChunkType = z.infer<typeof FinalOutputChunkSchema>;

// Type guard functions
export function isStepChunk(chunk: AgentStreamChunk): chunk is StepChunk {
  return chunk.type === "step";
}

export function isTimeoutChunk(chunk: AgentStreamChunk): chunk is TimeoutChunk {
  return chunk.type === "step_timeout";
}

export function isStepChunkError(
  chunk: AgentStreamChunk
): chunk is StepChunkError {
  return chunk.type === "step_error";
}

export function isFinalOutputChunk(
  chunk: AgentStreamChunk
): chunk is FinalOutputChunk {
  return chunk.type === "final_output";
}

/**
 * Represents the agent's current state
 */
export class AgentState {
  messages: Message[];

  /**
   * Initialize agent state
   * @param options - Initialize with provided values or defaults
   */
  constructor(options: { messages?: Message[] } = {}) {
    const { messages = [] } = options;
    this.messages = messages;
  }

  /**
   * Convert state to JSON string
   * @returns JSON string representing the state
   */
  toJSON(): string {
    return JSON.stringify({
      messages: this.messages,
    });
  }

  /**
   * Create an AgentState from a JSON string
   * @param json - JSON string representing the state
   * @returns New AgentState instance
   */
  static fromJSON(json: string): AgentState {
    try {
      const data = JSON.parse(json);
      return new AgentState({
        messages: data.messages || [],
      });
    } catch (error) {
      throw new Error(`Failed to parse AgentState from JSON: ${error}`);
    }
  }
}

/**
 * Result of an action execution
 */
export class ActionResult {
  isDone: boolean;
  content?: string;
  error?: string;
  giveControl: boolean;

  /**
   * Initialize action result
   * @param options - Initialize with provided values or defaults
   */
  constructor(
    options: {
      isDone?: boolean;
      content?: string;
      error?: string;
      giveControl?: boolean;
    } = {}
  ) {
    const { isDone = false, content, error, giveControl = false } = options;

    this.isDone = isDone;
    this.content = content;
    this.error = error;
    this.giveControl = giveControl;
  }
}

/**
 * Model for an action to be executed
 */
export class ActionModel {
  name: string;
  params: Record<string, any>;

  /**
   * Initialize action model
   * @param name - Name of the action
   * @param params - Parameters for the action
   */
  constructor(name: string, params: Record<string, any> = {}) {
    this.name = name;
    this.params = params;
  }
}

/**
 * Output from LLM with next action to take
 */
export class AgentLLMOutput {
  thought: string;
  action: ActionModel;
  summary: string;
  thinkingBlock?: ThinkingBlock;

  /**
   * Initialize LLM output
   * @param options - Initialize with provided values
   */
  constructor(options: {
    thought: string;
    action: ActionModel | Record<string, any>;
    summary: string;
    thinkingBlock?: ThinkingBlock;
  }) {
    const { thought, action, summary, thinkingBlock } = options;

    this.thought = thought;

    // Handle the action being either an ActionModel or a plain object
    if (action instanceof ActionModel) {
      this.action = action;
    } else {
      this.action = new ActionModel(action.name, action.params || {});
    }

    this.summary = summary;
    this.thinkingBlock = thinkingBlock;
  }

  /**
   * Serialize the output to JSON
   * @param indent - Number of spaces to indent
   * @param includeFields - Fields to include in the output
   * @returns JSON string
   */
  toJSON(
    indent: number = 2,
    includeFields: string[] = ["thought", "action", "summary"]
  ): string {
    const output: Record<string, any> = {};

    if (includeFields.includes("thought")) {
      output.thought = this.thought;
    }

    if (includeFields.includes("action")) {
      output.action = {
        name: this.action.name,
        params: this.action.params,
      };
    }

    if (includeFields.includes("summary") && this.summary) {
      output.summary = this.summary;
    }

    return JSON.stringify(output, null, indent);
  }

  /**
   * Create an AgentLLMOutput from a JSON string
   * @param jsonStr - JSON string
   * @returns AgentLLMOutput instance
   */
  static fromJSON(jsonStr: string): AgentLLMOutput {
    try {
      const data = JSON.parse(jsonStr);
      return new AgentLLMOutput({
        thought: data.thought || "",
        action: new ActionModel(
          data.action?.name || "",
          data.action?.params || {}
        ),
        summary: data.summary || "",
      });
    } catch (error) {
      throw new Error(`Failed to parse AgentLLMOutput from JSON: ${error}`);
    }
  }
}

/**
 * Final output of the agent's run
 */
export class AgentOutput {
  agentState: AgentState;
  result: ActionResult | null;
  stepCount: number;
  storageState?: any;
  traceId: string | null;

  /**
   * Initialize agent output
   * @param options - Initialize with provided values
   */
  constructor(options: {
    agentState: AgentState;
    result: ActionResult | null;
    stepCount?: number;
    storageState?: any;
    traceId?: string | null;
  }) {
    const {
      agentState,
      result,
      stepCount = 0,
      storageState,
      traceId = null,
    } = options;

    this.agentState = agentState;
    this.result = result;
    this.stepCount = stepCount;
    this.storageState = storageState;
    this.traceId = traceId;
  }
}

/**
 * Base class for streaming chunks
 */
export class AgentStreamChunk {
  type: string;

  constructor(type: string) {
    this.type = type;
  }
}

/**
 * Content for a step chunk
 */
export class StepChunkContent {
  actionResult: ActionResult;
  summary: string;
  traceId: string | null;
  screenshot?: string;

  /**
   * Initialize step chunk content
   * @param options - Initialize with provided values
   */
  constructor(options: {
    actionResult: ActionResult;
    summary: string;
    traceId?: string | null;
    screenshot?: string;
  }) {
    const { actionResult, summary, traceId = null, screenshot } = options;

    this.actionResult = actionResult;
    this.summary = summary;
    this.traceId = traceId;
    this.screenshot = screenshot;
  }
}

/**
 * Chunk for a step in the agent execution
 */
export class StepChunk extends AgentStreamChunk {
  content: StepChunkContent;

  /**
   * Initialize step chunk
   * @param options - Initialize with provided values
   */
  constructor(options: { content: StepChunkContent }) {
    super("step");
    this.content = options.content;
  }
}

/**
 * Content for a timeout chunk
 */
export class TimeoutChunkContent {
  actionResult: ActionResult;
  summary: string;
  step: number;
  agentState: AgentState;
  stepParentSpanContext?: string;
  traceId: string | null;
  screenshot?: string;

  /**
   * Initialize timeout chunk content
   * @param options - Initialize with provided values
   */
  constructor(options: {
    actionResult: ActionResult;
    summary: string;
    step: number;
    agentState: AgentState;
    stepParentSpanContext?: string;
    traceId?: string | null;
    screenshot?: string;
  }) {
    const {
      actionResult,
      summary,
      step,
      agentState,
      stepParentSpanContext,
      traceId = null,
      screenshot,
    } = options;

    this.actionResult = actionResult;
    this.summary = summary;
    this.step = step;
    this.agentState = agentState;
    this.stepParentSpanContext = stepParentSpanContext;
    this.traceId = traceId;
    this.screenshot = screenshot;
  }
}

/**
 * Chunk for a timeout in the agent execution
 */
export class TimeoutChunk extends AgentStreamChunk {
  content: TimeoutChunkContent;

  /**
   * Initialize timeout chunk
   * @param options - Initialize with provided values
   */
  constructor(options: { content: TimeoutChunkContent }) {
    super("step_timeout");
    this.content = options.content;
  }
}

/**
 * Chunk for an error in the agent execution
 */
export class StepChunkError extends AgentStreamChunk {
  content: string;

  /**
   * Initialize error chunk
   * @param options - Initialize with provided values
   */
  constructor(options: { content: string }) {
    super("step_error");
    this.content = options.content;
  }
}

/**
 * Chunk for final output of the agent execution
 */
export class FinalOutputChunk extends AgentStreamChunk {
  content: AgentOutput;

  /**
   * Initialize final output chunk
   * @param options - Initialize with provided values
   */
  constructor(options: { content: AgentOutput }) {
    super("final_output");
    this.content = options.content;
  }
}
