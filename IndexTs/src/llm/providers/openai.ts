// src/llm/providers/openai.ts
import OpenAI from '@openai/openai';
import { z } from 'zod';
import { BaseLLMProvider, LLMResponse, LLMResponseSchema, Message } from '@/llm/llm';
import dotenv from 'dotenv';

dotenv.config();

export class OpenAIProvider extends BaseLLMProvider {
  private client: OpenAI;

  constructor(model: string) {
    super(model);
    this.client = new OpenAI(); // Assumes OPENAI_API_KEY is in environment variables
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
    const formattedMessages = this.toOpenAIFormat(preparedMessages);

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: formattedMessages as any, // Cast needed due to OpenAI's specific type
        temperature: options?.temperature ?? 0.7, // Default temperature
        max_tokens: options?.max_tokens,
        ...(options?.tools && { tools: options.tools }), // Include tools if provided
        ...(options?.tool_choice && { tool_choice: options.tool_choice }), // Include tool_choice if provided
      });

      const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      // Basic validation - ensure content exists
      if (!response.choices[0]?.message?.content) {
         // Handle tool calls if content is null
        if (response.choices[0]?.message?.tool_calls) {
            // Return a response structure indicating a tool call
            // The Agent will need to handle this specific response format
             return LLMResponseSchema.parse({
                content: "", // No text content for tool call
                raw_response: response, // Include the full response for tool call details
                usage: {
                    prompt_tokens: usage.prompt_tokens,
                    completion_tokens: usage.completion_tokens,
                    total_tokens: usage.total_tokens,
                },
            });
        } else {
            throw new Error('Invalid response from OpenAI: No content or tool calls.');
        }
      }

      // Use Zod schema to parse and validate the expected structure
      const parsedResponse = LLMResponseSchema.parse({
        content: response.choices[0].message.content,
        raw_response: response,
        usage: {
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
        },
      });

      return parsedResponse;
    } catch (error) {
      console.error("Error calling OpenAI:", error);
      // Consider more specific error handling or re-throwing
      if (error instanceof z.ZodError) {
        throw new Error(`LLM response validation failed: ${error.errors.join(', ')}`);
      }
      throw new Error(`Failed to call OpenAI: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
