/**
 * Index - A browser automation agent with LLM integration
 * TypeScript port of the original Python project
 */

// Re-export components from browser module
export * from "./browser/browser.js";
export * from "./browser/models.js";
export * from "./browser/detector.js";
export * from "./browser/utils.js";

// Re-export components from agent module
export * from "./agent/agent.js";
export * from "./agent/models.js";
export * from "./agent/message_manager.js";
export * from "./agent/prompts.js";
export * from "./agent/utils.js";

// Re-export components from controller module
export * from "./controller/controller.js";
export * from "./controller/default_actions.js";

// Re-export components from LLM module
export * from "./llm/llm.js";
export * from "./llm/providers/openai.js";

// Example usage:
//
// ```typescript
// import { Agent } from 'index';
// import { OpenAIProvider } from 'index/llm/providers/openai';
//
// const provider = new OpenAIProvider({
//   apiKey: process.env.OPENAI_API_KEY,
//   model: 'gpt-4-vision-preview'
// });
//
// const agent = new Agent(provider);
//
// const run = async () => {
//   const output = await agent.run({
//     prompt: "Search for 'TypeScript tutorials' and find the top 3 results",
//     maxSteps: 20
//   });
//
//   console.log('Task completed with result:', output.result?.content);
// };
//
// run().catch(console.error);
// ```
