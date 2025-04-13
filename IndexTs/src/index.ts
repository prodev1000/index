// src/index.ts
import dotenv from 'dotenv';
import { OpenAIProvider } from './llm/providers/openai';
import { AnthropicProvider } from './llm/providers/anthropic';
import { Agent } from './agent/agent';
import { BrowserConfig } from './browser/browser';

// Load environment variables
dotenv.config();

/**
 * Main function to run the agent
 */
async function main() {
    try {
        // Check for required environment variables
        if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
            console.error('Error: OPENAI_API_KEY or ANTHROPIC_API_KEY must be set in environment');
            process.exit(1);
        }

        // Parse command line arguments
        const taskPrompt = process.argv[2] || "Search for information about the Index project on GitHub";
        const modelName = process.argv[3] || (process.env.ANTHROPIC_API_KEY ? 'claude-3-sonnet-20240229' : 'gpt-4');
        const useLlm = process.argv[4] || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai');

        console.log(`Task: ${taskPrompt}`);
        console.log(`Using model: ${modelName}`);
        console.log(`LLM provider: ${useLlm}`);

        // Configure browser
        const browserConfig: BrowserConfig = {
            viewportSize: { width: 1200, height: 800 },
            // Optional CV model endpoint if you have one
            // cvModelEndpoint: "https://your-cv-model-endpoint"
        };

        // Create LLM provider
        const llmProvider = useLlm === 'anthropic' 
            ? new AnthropicProvider(modelName)
            : new OpenAIProvider(modelName);

        // Create and initialize agent
        const agent = new Agent(llmProvider, browserConfig);
        
        // Run the agent and get results
        console.log('Starting agent...');
        const result = await agent.run(taskPrompt);
        
        console.log('\n--- AGENT COMPLETED ---');
        console.log(`Steps taken: ${result.step_count}`);
        console.log('Final result:', result.result);
        
        // Clean up
        await agent.close();
    } catch (error) {
        console.error('Error running agent:', error);
        process.exit(1);
    }
}

// Streaming example
async function streamingExample() {
    try {
        // Check for required environment variables
        if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
            console.error('Error: OPENAI_API_KEY or ANTHROPIC_API_KEY must be set in environment');
            process.exit(1);
        }

        // Parse command line arguments
        const taskPrompt = process.argv[2] || "Search for information about the Index project on GitHub";
        const modelName = process.argv[3] || (process.env.ANTHROPIC_API_KEY ? 'claude-3-sonnet-20240229' : 'gpt-4');
        const useLlm = process.argv[4] || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai');

        console.log(`Task: ${taskPrompt}`);
        console.log(`Using model: ${modelName}`);
        console.log(`LLM provider: ${useLlm}`);

        // Configure browser
        const browserConfig: BrowserConfig = {
            viewportSize: { width: 1200, height: 800 },
        };

        // Create LLM provider
        const llmProvider = useLlm === 'anthropic' 
            ? new AnthropicProvider(modelName)
            : new OpenAIProvider(modelName);

        // Create and initialize agent
        const agent = new Agent(llmProvider, browserConfig);
        
        // Stream the agent execution
        console.log('Starting agent in streaming mode...');
        
        for await (const chunk of agent.runStream(taskPrompt, { maxSteps: 20, timeout: 60000 })) {
            switch (chunk.type) {
                case 'step':
                    console.log(`\n--- STEP COMPLETE ---`);
                    console.log(`Summary: ${chunk.content.summary}`);
                    console.log(`Action result: ${chunk.content.action_result.content || chunk.content.action_result.error || 'No content'}`);
                    break;
                case 'step_timeout':
                    console.log(`\n--- STEP TIMEOUT ---`);
                    console.log(`Error: ${chunk.content.action_result.error}`);
                    break;
                case 'step_error':
                    console.log(`\n--- STEP ERROR ---`);
                    console.log(`Error: ${chunk.content}`);
                    break;
                case 'final_output':
                    console.log(`\n--- FINAL OUTPUT ---`);
                    console.log(`Steps taken: ${chunk.content.step_count}`);
                    console.log(`Final result: ${chunk.content.result.content || chunk.content.result.error || 'No content'}`);
                    break;
            }
        }
        
        // No need to call agent.close() as it's closed automatically at the end of runStream
    } catch (error) {
        console.error('Error running streaming example:', error);
        process.exit(1);
    }
}

// Run the example based on streaming flag
if (process.argv.includes('--stream')) {
    streamingExample().catch(console.error);
} else {
    main().catch(console.error);
}
