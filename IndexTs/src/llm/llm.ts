// src/llm/llm.ts
import { z } from 'zod';

export enum MessageRole {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
  TOOL = 'tool', // For OpenAI function calling responses
}

// Base schema for content blocks
const BaseContentSchema = z.object({
  cache_control: z.object({ type: z.literal('ephemeral') }).optional(),
});

// Schema for text content
export const TextContentSchema = BaseContentSchema.extend({
  type: z.literal('text'),
  text: z.string(),
});
export type TextContent = z.infer<typeof TextContentSchema>;

// Schema for image content (using URL for simplicity in TS, can adapt for base64)
export const ImageContentSchema = BaseContentSchema.extend({
  type: z.literal('image'),
  source: z.object({
    type: z.union([z.literal('base64'), z.literal('url')]), // Allow base64 or URL
    media_type: z.string(), // e.g., 'image/png', 'image/jpeg'
    data: z.string(), // Base64 string or URL
  }),
});
export type ImageContent = z.infer<typeof ImageContentSchema>;

// Schema for Anthropic's thinking block
export const ThinkingBlockSchema = BaseContentSchema.extend({
    type: z.literal('thinking'),
    thinking: z.string(),
    signature: z.string().optional(), // Signature might not always be present
});
export type ThinkingBlock = z.infer<typeof ThinkingBlockSchema>;


// Union schema for different content types
export const MessageContentSchema = z.union([
  TextContentSchema,
  ImageContentSchema,
  ThinkingBlockSchema,
]);
export type MessageContent = z.infer<typeof MessageContentSchema>;

// Schema for a single message
export const MessageSchema = z.object({
  role: z.nativeEnum(MessageRole),
  content: z.union([z.string(), z.array(MessageContentSchema)]),
  name: z.string().optional(), // For tool/function messages
  tool_call_id: z.string().optional(), // For tool/function responses
  is_state_message: z.boolean().optional().default(false),
});
export type Message = z.infer<typeof MessageSchema>;

// Helper function to create a simple text message
export function createTextMessage(role: MessageRole, text: string): Message {
    return {
        role,
        content: [{ type: 'text', text }],
    };
}

// Helper function to create an image message (base64)
export function createImageMessage(role: MessageRole, base64Data: string, mediaType: string = 'image/png'): Message {
    return {
        role,
        content: [{
            type: 'image',
            source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data,
            }
        }],
    };
}


// Schema for the response from an LLM call
export const LLMResponseSchema = z.object({
  content: z.string(),
  raw_response: z.any(), // Store the original provider response
  usage: z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
  }).passthrough(), // Allow other usage fields
  thinking: ThinkingBlockSchema.optional(),
});
export type LLMResponse = z.infer<typeof LLMResponseSchema>;

// Abstract class for LLM providers
export abstract class BaseLLMProvider {
  protected model: string;

  constructor(model: string) {
    this.model = model;
  }

  abstract call(
    messages: Message[],
    options?: {
        temperature?: number;
        max_tokens?: number;
        [key: string]: any; // Allow additional provider-specific options
    }
  ): Promise<LLMResponse>;

  // Utility to potentially prepare messages (e.g., ensure content is array)
  protected prepareMessages(messages: Message[]): Message[] {
    return messages.map(msg => {
      if (typeof msg.content === 'string') {
        return { ...msg, content: [{ type: 'text', text: msg.content }] };
      }
      return msg;
    });
  }

    // Utility to convert internal Message format to Anthropic format
    protected toAnthropicFormat(messages: Message[], enableCacheControl: boolean = true): any[] {
        return messages.map(msg => {
            const anthropicMsg: any = { role: msg.role };
            if (Array.isArray(msg.content)) {
                anthropicMsg.content = msg.content.map(block => {
                    const anthropicBlock: any = { type: block.type };
                    if (block.type === 'text') {
                        anthropicBlock.text = block.text;
                    } else if (block.type === 'image') {
                        anthropicBlock.source = block.source;
                    } else if (block.type === 'thinking') {
                        // Thinking blocks are usually received, not sent, but handle if needed
                        anthropicBlock.thinking = block.thinking;
                        if (block.signature) anthropicBlock.signature = block.signature;
                    }

                    // Add cache control if enabled and present
                    if (enableCacheControl && (block as any).cache_control) {
                        anthropicBlock.cache_control = { type: 'ephemeral' };
                    }
                    return anthropicBlock;
                });
            } else { // Handle simple string content if it somehow occurs
                 anthropicMsg.content = msg.content;
            }
            return anthropicMsg;
        });
    }

     // Utility to convert internal Message format to OpenAI format
    protected toOpenAIFormat(messages: Message[]): any[] {
        return messages.map(msg => {
            const openAIMsg: any = { role: msg.role };
            if (Array.isArray(msg.content)) {
                 // If only one text block, OpenAI expects simple content string
                if (msg.content.length === 1 && msg.content[0].type === 'text') {
                    openAIMsg.content = msg.content[0].text;
                } else {
                    // Otherwise, map to OpenAI's content array format
                    openAIMsg.content = msg.content.map(block => {
                        if (block.type === 'text') {
                            return { type: 'text', text: block.text };
                        } else if (block.type === 'image') {
                            // OpenAI uses image_url format
                            return {
                                type: 'image_url',
                                image_url: {
                                    url: block.source.type === 'base64'
                                        ? `data:${block.source.media_type};base64,${block.source.data}`
                                        : block.source.data // Assuming URL if not base64
                                }
                            };
                        }
                        // OpenAI doesn't support 'thinking' blocks in input
                        return null;
                    }).filter(block => block !== null); // Filter out nulls (like thinking blocks)
                }
            } else {
                 openAIMsg.content = msg.content; // Simple string content
            }

            if (msg.name) openAIMsg.name = msg.name;
            if (msg.tool_call_id) openAIMsg.tool_call_id = msg.tool_call_id;

            return openAIMsg;
        });
    }
}
