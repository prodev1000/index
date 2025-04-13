// src/agent/models.ts
import { z } from 'zod';
import { ActionModel, ActionModelSchema, ActionResult, ActionResultSchema } from '@/controller/models';
import { Message } from '@/llm/llm';
import * as playwright from 'playwright';

// State of the agent
export const AgentStateSchema = z.object({
    messages: z.array(z.any()) // Using any because circular references with Message type
});
export type AgentState = z.infer<typeof AgentStateSchema>;

// Structure expected from the LLM
export const AgentLLMOutputSchema = z.object({
    thought: z.string(),
    action: ActionModelSchema,
    summary: z.string().optional(),
});
export type AgentLLMOutput = z.infer<typeof AgentLLMOutputSchema>;

// Final output from the agent
export const AgentOutputSchema = z.object({
    agent_state: AgentStateSchema,
    result: ActionResultSchema,
    step_count: z.number().default(0),
    storage_state: z.any().optional(), // StorageState from Playwright
    trace_id: z.string().optional().nullable()
});
export type AgentOutput = z.infer<typeof AgentOutputSchema>;

// Base class for stream chunks
export const AgentStreamChunkSchema = z.object({
    type: z.string()
});
export type AgentStreamChunk = z.infer<typeof AgentStreamChunkSchema>;

// Content for step chunks
export const StepChunkContentSchema = z.object({
    action_result: ActionResultSchema,
    summary: z.string(),
    trace_id: z.string().optional().nullable(),
    screenshot: z.string().optional().nullable()
});
export type StepChunkContent = z.infer<typeof StepChunkContentSchema>;

// Step chunk (normal step execution)
export const StepChunkSchema = AgentStreamChunkSchema.extend({
    type: z.literal('step'),
    content: StepChunkContentSchema
});
export type StepChunk = z.infer<typeof StepChunkSchema>;

// Content for timeout chunks
export const TimeoutChunkContentSchema = z.object({
    action_result: ActionResultSchema,
    summary: z.string(),
    step: z.number(),
    agent_state: AgentStateSchema,
    step_parent_span_context: z.string().optional().nullable(),
    trace_id: z.string().optional().nullable(),
    screenshot: z.string().optional().nullable()
});
export type TimeoutChunkContent = z.infer<typeof TimeoutChunkContentSchema>;

// Timeout chunk (step execution timed out)
export const TimeoutChunkSchema = AgentStreamChunkSchema.extend({
    type: z.literal('step_timeout'),
    content: TimeoutChunkContentSchema
});
export type TimeoutChunk = z.infer<typeof TimeoutChunkSchema>;

// Error chunk
export const StepChunkErrorSchema = AgentStreamChunkSchema.extend({
    type: z.literal('step_error'),
    content: z.string()
});
export type StepChunkError = z.infer<typeof StepChunkErrorSchema>;

// Final output chunk
export const FinalOutputChunkSchema = AgentStreamChunkSchema.extend({
    type: z.literal('final_output'),
    content: AgentOutputSchema
});
export type FinalOutputChunk = z.infer<typeof FinalOutputChunkSchema>;
