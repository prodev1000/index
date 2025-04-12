import { z } from "zod";

// Enums
export enum MessageRole {
  SYSTEM = "system",
  USER = "user",
  ASSISTANT = "assistant",
  TOOL = "tool", // For OpenAI function calling responses
}

export enum LLMProvider {
  OPENAI = "openai",
  ANTHROPIC = "anthropic",
  // Add more providers as needed
}

export enum LLMModel {
  GPT4 = "gpt-4",
  GPT35 = "gpt-3.5-turbo",
  CLAUDE3_OPUS = "claude-3-opus-20240229",
  CLAUDE3_SONNET = "claude-3-sonnet-20240229",
  // Add more models as needed
}

// Base message content interface
export interface MessageContent {
  type: string;
  cacheControl?: boolean;
}

export interface TextContent extends MessageContent {
  type: "text";
  text: string;
}

export interface ImageContent extends MessageContent {
  type: "image";
  imageB64?: string;
  imageUrl?: string;
}

export interface ThinkingBlock extends MessageContent {
  type: "thinking";
  thinking: string;
  signature: string;
}

export type ContentType = TextContent | ImageContent | ThinkingBlock;

// Message class
export class Message {
  role: string;
  content: ContentType[];
  name?: string;
  toolCallId?: string;
  isStateMessage?: boolean;

  constructor(
    role: string | MessageRole,
    content: string | ContentType | ContentType[],
    name?: string,
    toolCallId?: string,
    isStateMessage = false
  ) {
    // Convert role enum to string if needed
    this.role = typeof role === "string" ? role : role.toString();
    this.name = name;
    this.toolCallId = toolCallId;
    this.isStateMessage = isStateMessage;

    // Convert content to array of ContentType
    if (typeof content === "string") {
      this.content = [{ type: "text", text: content } as TextContent];
    } else if (Array.isArray(content)) {
      this.content = content;
    } else {
      this.content = [content];
    }
  }

  toOpenAIFormat(): Record<string, any> {
    const message: Record<string, any> = { role: this.role };

    // Handle different content types
    if (this.content.length === 1 && this.content[0].type === "text") {
      message.content = (this.content[0] as TextContent).text;
    } else {
      message.content = this.content.map((content) => {
        if (content.type === "text") {
          return {
            type: "text",
            text: (content as TextContent).text,
          };
        } else if (content.type === "image") {
          const imageContent = content as ImageContent;
          return {
            type: "image",
            image_url: imageContent.imageUrl || {
              type: "base64",
              media_type: "image/png",
              data: imageContent.imageB64,
            },
          };
        } else if (content.type === "thinking") {
          return {
            type: "thinking",
            thinking: (content as ThinkingBlock).thinking,
            signature: (content as ThinkingBlock).signature,
          };
        }
        return {};
      });
    }

    if (this.name) {
      message.name = this.name;
    }

    if (this.toolCallId) {
      message.tool_call_id = this.toolCallId;
    }

    return message;
  }

  toAnthropicFormat(enableCacheControl = true): Record<string, any> {
    const message: Record<string, any> = { role: this.role };

    const contentBlocks = this.content.map((contentBlock) => {
      let block: Record<string, any> = {};

      if (contentBlock.type === "text") {
        block.type = "text";
        block.text = (contentBlock as TextContent).text;
      } else if (contentBlock.type === "image") {
        const imageContent = contentBlock as ImageContent;
        block.type = "image";
        block.source = {
          type: "base64",
          media_type: "image/png", // This should be configurable based on image type
          data: imageContent.imageB64 || imageContent.imageUrl,
        };
      } else if (contentBlock.type === "thinking") {
        const thinkingContent = contentBlock as ThinkingBlock;
        block.type = "thinking";
        block.thinking = thinkingContent.thinking;
        block.signature = thinkingContent.signature;
      }

      if (contentBlock.cacheControl && enableCacheControl) {
        block.cache_control = { type: "ephemeral" };
      }

      return block;
    });

    message.content = contentBlocks;
    return message;
  }

  removeCacheControl(): void {
    this.content.forEach((contentBlock) => {
      contentBlock.cacheControl = undefined;
    });
  }

  addCacheControlToStateMessage(): void {
    if (!this.isStateMessage || this.content.length < 3) {
      return;
    }

    if (this.content.length === 3) {
      this.content[2].cacheControl = true;
    }
  }

  hasCacheControl(): boolean {
    return this.content.some((content) => content.cacheControl === true);
  }
}

// Zod schema for LLMResponse
export const LLMResponseSchema = z.object({
  content: z.string(),
  rawResponse: z.any(),
  usage: z.record(z.number()),
  thinking: z
    .object({
      type: z.literal("thinking"),
      thinking: z.string(),
      signature: z.string(),
      cacheControl: z.boolean().optional(),
    })
    .optional(),
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

// Abstract base class for LLM providers
export abstract class BaseLLMProvider {
  model: string;

  constructor(model: string) {
    this.model = model;
  }

  abstract call(
    messages: Message[],
    temperature?: number,
    maxTokens?: number | null,
    ...args: any[]
  ): Promise<LLMResponse>;
}
