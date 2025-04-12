import OpenAI from "openai";
import { BaseLLMProvider, LLMResponse, Message } from "../llm.js";

export class OpenAIProvider extends BaseLLMProvider {
  private client: OpenAI;
  private systemMessage?: string;

  constructor(model: string, systemMessage?: string) {
    super(model);
    this.client = new OpenAI();
    this.systemMessage = systemMessage;
  }

  private prepareMessages(messages: Message[]): Message[] {
    if (
      this.systemMessage &&
      messages.length > 0 &&
      messages[0].role !== "system"
    ) {
      const systemMsg = new Message("system", this.systemMessage);
      return [systemMsg, ...messages];
    }
    return messages;
  }

  async call(
    messages: Message[],
    temperature: number = 0.7,
    maxTokens: number | null = null,
    ...args: any[]
  ): Promise<LLMResponse> {
    const preparedMessages = this.prepareMessages(messages);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: preparedMessages.map((msg) => msg.toOpenAIFormat()) as any,
      temperature,
      max_tokens: maxTokens || undefined,
      ...args[0],
    });

    return {
      content: response.choices[0].message.content || "",
      rawResponse: response,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
    };
  }
}
