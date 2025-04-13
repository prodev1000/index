// src/agent/agent.ts
import { Browser, BrowserConfig } from '@/browser/browser';
import { Controller } from '@/controller/controller';
import { ActionModel, ActionResult } from '@/controller/models';
import { BaseLLMProvider } from '@/llm/llm';
import { MessageManager } from './message_manager';
import {
    AgentLLMOutput,
    AgentLLMOutputSchema,
    AgentOutput,
    AgentState,
    FinalOutputChunk,
    StepChunk,
    StepChunkError,
    TimeoutChunk
} from './models';

interface StepOptions {
    prevActionResult?: ActionResult;
    timeout?: number;
}

interface RunStreamOptions extends StepOptions {
    maxSteps?: number;
    prevStep?: number;
    agentState?: string;
}

export class Agent {
    private llm: BaseLLMProvider;
    private browser?: Browser;
    private controller: Controller;
    private messageManager: MessageManager;
    private state: AgentState;
    private browserConfig?: BrowserConfig;
    private isSetup: boolean = false;

    /**
     * Create an Agent instance
     * 
     * @param llm - LLM provider instance
     * @param browserConfig - Optional browser configuration
     */
    constructor(llm: BaseLLMProvider, browserConfig?: BrowserConfig) {
        this.llm = llm;
        this.browserConfig = browserConfig;
        this.controller = new Controller();
        this.messageManager = new MessageManager(this.controller.getActionDescriptions());
        this.state = { messages: [] };
    }

    /**
     * Setup the agent environment and messages
     * 
     * @param userPrompt - User's task description
     * @param agentState - Optional serialized agent state to restore from
     * @returns The agent instance for chaining
     */
    async setup(userPrompt: string, agentState?: string): Promise<Agent> {
        // Initialize browser if not already done
        if (!this.browser) {
            this.browser = new Browser(this.browserConfig);
            await this.browser.init();
        }

        // Setup initial messages
        await this.setupMessages(userPrompt, agentState);
        this.isSetup = true;
        return this;
    }

    /**
     * Set up the message history
     * 
     * @param userPrompt - User's task description
     * @param agentState - Optional serialized agent state to restore from
     * @private
     */
    private async setupMessages(userPrompt: string, agentState?: string): Promise<void> {
        if (agentState) {
            try {
                // Parse and restore the agent state
                const state = JSON.parse(agentState) as AgentState;
                this.messageManager.setMessages(state.messages);
                console.log("Restored agent state from provided state");
            } catch (e) {
                console.error("Failed to parse agent state, starting fresh:", e);
                await this.messageManager.addSystemMessageAndUserPrompt(userPrompt);
            }
        } else {
            // Start with a fresh system message and user prompt
            await this.messageManager.addSystemMessageAndUserPrompt(userPrompt);
        }
    }

    /**
     * Get the current agent state
     * 
     * @returns The current agent state
     */
    getState(): AgentState {
        return {
            messages: this.messageManager.getMessages()
        };
    }

    /**
     * Execute a single step of the agent process
     * 
     * @param options - Step options including previous action result
     * @returns A tuple containing the action result and summary
     */
    async step(options: StepOptions = {}): Promise<[ActionResult, string]> {
        if (!this.isSetup || !this.browser) {
            throw new Error("Agent not properly set up. Call setup() first.");
        }

        // Update browser state
        await this.browser.updateState();

        // Add current state to message history
        await this.messageManager.addCurrentStateMessage(
            this.browser.getState(), 
            options.prevActionResult
        );

        // Get messages to send to the LLM
        const messages = this.messageManager.getMessages();

        // Generate the next action using the LLM
        const output = await this.generateAction(messages);

        // Save the current state snapshot
        const stateSnapshot = this.browser.getState();
        
        // Remove the temporary state message (it will be added back properly later)
        const currentMessages = this.messageManager.getMessages();
        currentMessages.pop();
        this.messageManager.setMessages(currentMessages);

        // Add the LLM's response to the message history with the state screenshot
        await this.messageManager.addMessageFromModelOutput(
            output,
            stateSnapshot.screenshot,
            output.thinking
        );

        // Execute the selected action
        const actionResult = await this.controller.executeAction(
            output.action,
            this.browser
        );

        const summary = output.summary || '';
        return [actionResult, summary];
    }

    /**
     * Generate an action using the LLM based on current messages
     * 
     * @param messages - Current message history
     * @returns Parsed LLM output
     * @private
     */
    private async generateAction(messages: any[]): Promise<AgentLLMOutput> {
        try {
            // Call the LLM with the current message history
            const response = await this.llm.call(messages);
            
            // The response should be a JSON string within <output> or <o> tags
            let jsonContent = response.content;
            
            // Clean the response text
            jsonContent = jsonContent.replace(/\u0000/g, ''); // Remove null chars

            // Extract JSON within tags
            let match = jsonContent.match(/<(?:output|o)>([\s\S]*?)<\/(?:output|o)>/);
            if (match && match[1]) {
                jsonContent = match[1].trim();
            } else {
                // Try to find JSON without tags
                match = jsonContent.match(/\{\s*"thought"[\s\S]*\}/);
                if (match) {
                    jsonContent = match[0].trim();
                } else {
                    throw new Error('Could not extract JSON from LLM response');
                }
            }
            
            // Parse and validate the extracted JSON
            const parsedOutput = JSON.parse(jsonContent);
            
            // Ensure the output matches expected schema
            const validatedOutput = AgentLLMOutputSchema.parse(parsedOutput);
            
            // Attach thinking if available
            if (response.thinking) {
                (validatedOutput as any).thinking = response.thinking;
            }
            
            return validatedOutput;
        } catch (error) {
            console.error('Error generating action:', error);
            throw new Error(`Failed to generate action: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Run the agent to complete the task synchronously
     * 
     * @param prompt - User's task description
     * @param maxSteps - Maximum number of steps to take
     * @param agentState - Optional serialized agent state to restore from
     * @returns The final agent output
     */
    async run(
        prompt: string,
        maxSteps: number = 20,
        agentState?: string
    ): Promise<AgentOutput> {
        await this.setup(prompt, agentState);
        
        let stepCount = 0;
        let actionResult: ActionResult | undefined;
        let isDone = false;
        
        while (stepCount < maxSteps && !isDone) {
            const [result, _] = await this.step({ prevActionResult: actionResult });
            actionResult = result;
            stepCount++;
            
            // Check if the task is complete
            if (actionResult.is_done) {
                isDone = true;
            }
        }
        
        const state = this.getState();
        let storageState;
        
        // Get storage state and close browser if needed
        if (this.browser) {
            storageState = await this.browser.getStorageState();
            await this.browser.close();
            this.browser = undefined;
        }
        
        return {
            agent_state: state,
            result: actionResult || { error: "No action result" },
            step_count: stepCount,
            storage_state: storageState
        };
    }

    /**
     * Run the agent in a streaming fashion, yielding results after each step
     * 
     * @param prompt - User's task description
     * @param options - Stream options including max steps, timeouts, etc.
     * @returns An async generator yielding step results
     */
    async *runStream(
        prompt: string,
        options: RunStreamOptions = {}
    ): AsyncGenerator<StepChunk | TimeoutChunk | StepChunkError | FinalOutputChunk, void, unknown> {
        const { 
            maxSteps = 20, 
            prevStep = 0,
            prevActionResult,
            timeout,
            agentState
        } = options;
        
        try {
            await this.setup(prompt, agentState);
            
            let stepCount = prevStep;
            let actionResult = prevActionResult;
            let isDone = false;
            
            while (stepCount < maxSteps && !isDone) {
                try {
                    // Execute step with optional timeout
                    const result = await this.executeStepWithTimeout({ 
                        prevActionResult: actionResult,
                        timeout
                    });
                    
                    if (result.type === 'step_timeout') {
                        // Yield timeout chunk and stop
                        yield result;
                        break;
                    }
                    
                    // Step executed successfully
                    const [step_result, summary] = result.data;
                    actionResult = step_result;
                    stepCount++;
                    
                    // Yield the step chunk
                    const stepChunk: StepChunk = {
                        type: 'step',
                        content: {
                            action_result: actionResult,
                            summary,
                            screenshot: this.browser?.getState().screenshot || null
                        }
                    };
                    
                    yield stepChunk;
                    
                    // Check if done
                    if (actionResult.is_done) {
                        isDone = true;
                    }
                } catch (error) {
                    const errorMsg = `Error during step ${stepCount}: ${error instanceof Error ? error.message : String(error)}`;
                    console.error(errorMsg);
                    
                    // Yield error chunk but continue execution
                    const errorChunk: StepChunkError = {
                        type: 'step_error',
                        content: errorMsg
                    };
                    
                    yield errorChunk;
                    
                    // Try to continue with next step
                    stepCount++;
                }
            }
            
            // Prepare final output
            const state = this.getState();
            let storageState;
            
            if (this.browser) {
                storageState = await this.browser.getStorageState();
                await this.browser.close();
                this.browser = undefined;
            }
            
            const finalOutput: AgentOutput = {
                agent_state: state,
                result: actionResult || { error: "No action result" },
                step_count: stepCount,
                storage_state: storageState
            };
            
            // Yield final output chunk
            const finalChunk: FinalOutputChunk = {
                type: 'final_output',
                content: finalOutput
            };
            
            yield finalChunk;
        } catch (error) {
            const errorMsg = `Error in runStream: ${error instanceof Error ? error.message : String(error)}`;
            console.error(errorMsg);
            
            // Yield error chunk as final output
            const errorChunk: StepChunkError = {
                type: 'step_error',
                content: errorMsg
            };
            
            yield errorChunk;
            
            // Close browser if needed
            if (this.browser) {
                try {
                    await this.browser.close();
                } catch (e) {
                    console.error("Error closing browser:", e);
                }
                this.browser = undefined;
            }
        }
    }

    /**
     * Execute a step with an optional timeout
     * 
     * @param options - Step options including timeout
     * @returns Step result or timeout chunk
     * @private
     */
    private async executeStepWithTimeout(options: StepOptions): Promise<
        { type: 'step', data: [ActionResult, string] } | 
        { type: 'step_timeout', data: TimeoutChunk }
    > {
        if (options.timeout) {
            // Create a promise that resolves with the step result
            const stepPromise = this.step(options);
            
            // Create a timeout promise
            const timeoutPromise = new Promise<TimeoutChunk>((resolve) => {
                setTimeout(() => {
                    const state = this.getState();
                    const browser_state = this.browser?.getState();
                    
                    resolve({
                        type: 'step_timeout',
                        content: {
                            action_result: { 
                                error: `Step timed out after ${options.timeout}ms` 
                            },
                            summary: "Execution timed out",
                            step: state.messages.length,
                            agent_state: state,
                            step_parent_span_context: null,
                            trace_id: null,
                            screenshot: browser_state?.screenshot || null
                        }
                    });
                }, options.timeout);
            });
            
            // Race the promises
            const result = await Promise.race([
                stepPromise.then(r => ({ type: 'step', data: r })),
                timeoutPromise.then(r => ({ type: 'step_timeout', data: r }))
            ]);
            
            return result;
        } else {
            // No timeout, just execute the step
            const result = await this.step(options);
            return { type: 'step', data: result };
        }
    }

    /**
     * Clean up resources
     */
    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = undefined;
        }
    }
}
