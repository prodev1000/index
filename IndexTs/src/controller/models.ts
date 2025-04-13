// src/controller/models.ts
import { z } from 'zod';

// Action result schema (return values from actions)
export const ActionResultSchema = z.object({
  is_done: z.boolean().optional().default(false),
  content: z.string().optional().nullable(),
  error: z.string().optional().nullable(),
  give_control: z.boolean().optional().default(false),
});
export type ActionResult = z.infer<typeof ActionResultSchema>;

// Action model schema (parameters for actions)
export const ActionModelSchema = z.object({
  name: z.string(),
  params: z.record(z.any()),
});
export type ActionModel = z.infer<typeof ActionModelSchema>;

// Action function interface (defines the signature of action handlers)
export interface ActionFunction {
  (params: any): Promise<ActionResult>;
}

// Action registration metadata
export interface Action {
  name: string;
  description: string;
  function: ActionFunction;
  browserContext: boolean;
}
