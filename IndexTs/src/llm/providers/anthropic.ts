// src/llm/providers/anthropic.ts
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  BaseLLMProvider,
  LLMResponse,
  LLMResponseSchema,
  Message,
  MessageRole,
  ThinkingBlockSchema
} from '@/llm/llm';
import dotenv from 'dotenv';

dotenv.config();

// Define the structure of the thinking response part from Anthropic
const AnthropicThinkingResponseSchema = z.object({
    type: z.literal('thinking'),
    thinking: z.string(),
    signature: z.string().optional(),
});

// Define the structure of the main content response part from Anthropic
const AnthropicContentResponseSchema = z.object({
    type: z.literal('text'),
    text: z.string(),
});

export class AnthropicProvider extends BaseLLMProvider {
  private client: Anthropic;
  private enableThinking: boolean;
  private thinkingTokenBudget: number | undefined;

  constructor(model: string, enableThinking: boolean = true, thinkingTokenBudget?: number) {
    super(model);
    this.client = new Anthropic(); // Assumes ANTHROPIC_API_KEY is in env
    this.enableThinking = enableThinking;
    this.thinkingTokenBudget = thinkingTokenBudget ?? 2048; // Default budget
    // Note: Bedrock fallback is omitted for initial simplicity
  }

  async call(
    messages: Message[],
    options?: {
      temperature?: number;
      max_tokens?: number;
      [key: string]: any;
    }
  ): Promise<LLMResponse> {
    const preparedMessages = this.prepareMessages(messages);

    let systemMessageContent: any | undefined = undefined;
    let userMessages = preparedMessages;

    if (preparedMessages.length > 0 && preparedMessages[0].role === MessageRole.SYSTEM) {
      // Anthropic expects system message content directly, not the full message object
      const systemMsg = preparedMessages[0];
      if (Array.isArray(systemMsg.content) && systemMsg.content[0]?.type === 'text') {
          systemMessageContent = systemMsg.content[0].text;
      } else if (typeof systemMsg.content === 'string') {
          systemMessageContent = systemMsg.content;
      } else {
          console.warn("System message format not suitable for Anthropic, ignoring.");
      }
      userMessages = preparedMessages.slice(1);
    }

    const formattedMessages = this.toAnthropicFormat(userMessages);

    const requestBody: Anthropic.Messages.MessageCreateParams = {
      model: this.model,
      messages: formattedMessages as any, // Cast needed
      system: systemMessageContent,
      temperature: options?.temperature ?? 1, // Default temperature for Anthropic often 1
      max_tokens: options?.max_tokens ?? 4096, // Default max_tokens for Anthropic
    };

    if (this.enableThinking) {
        requestBody.thinking = {
            type: "enabled",
            budget_tokens: this.thinkingTokenBudget,
        };
        // Adjust max_tokens if thinking is enabled to ensure space for both
        requestBody.max_tokens = Math.max(this.thinkingTokenBudget + 1, requestBody.max_tokens);
    }

    try {
      const response = await this.client.messages.create(requestBody);

      let thinkingBlock: z.infer<typeof ThinkingBlockSchema> | undefined = undefined;
      let responseContent: string = '';

      // Process content blocks
      if (Array.isArray(response.content)) {
          for (const block of response.content) {
              if (block.type === 'thinking') {
                  const parsedThinking = AnthropicThinkingResponseSchema.safeParse(block);
                  if (parsedThinking.success) {
                      thinkingBlock = parsedThinking.data;
                  } else {
                      console.warn("Failed to parse thinking block:", parsedThinking.error);
                  }
              } else if (block.type === 'text') {
                  const parsedContent = AnthropicContentResponseSchema.safeParse(block);
                  if (parsedContent.success) {
                      // Concatenate multiple text blocks if they exist
                      responseContent += (responseContent ? '\n' : '') + parsedContent.data.text;
                  } else {
                       console.warn("Failed to parse content block:", parsedContent.error);
                  }
              }
          }
      }

      if (!responseContent && !thinkingBlock) {
          throw new Error('Invalid response from Anthropic: No valid content or thinking blocks found.');
      }
      // If thinking was enabled but not returned, ensure content is extracted correctly
      if (this.enableThinking && !thinkingBlock && response.content[0]?.type === 'text') {
          responseContent = response.content[0].text;
      }

      const usage = response.usage ?? { input_tokens: 0, output_tokens: 0 };

      // Use Zod schema to parse and validate the final structure
      const parsedResponse = LLMResponseSchema.parse({
        content: responseContent,
        raw_response: response,
        usage: {
          prompt_tokens: usage.input_tokens,
          completion_tokens: usage.output_tokens,
          total_tokens: usage.input_tokens + usage.output_tokens,
        },
        thinking: thinkingBlock,
      });

      return parsedResponse;

    } catch (error) {
      console.error("Error calling Anthropic:", error);
      if (error instanceof z.ZodError) {
        throw new Error(`LLM response validation failed: ${error.errors.join(', ')}`);
      }
      throw new Error(`Failed to call Anthropic: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
