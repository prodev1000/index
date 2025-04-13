// src/controller/controller.ts
import { Browser } from '@/browser/browser';
import { Action, ActionFunction, ActionModel, ActionResult, ActionResultSchema } from './models';
import { registerDefaultActions } from './default_actions';

export class Controller {
    private actions: Map<string, Action> = new Map();
    private excludeActions: string[] = [];
    
    constructor(excludeActions: string[] = []) {
        this.excludeActions = excludeActions;
        
        // Register default actions
        registerDefaultActions(this);
    }
    
    /**
     * Register an action with the controller
     * 
     * @param name - Name of the action
     * @param description - Description of what the action does
     * @param func - Function to execute for this action
     * @param browserContext - Whether the action needs browser context
     */
    registerAction(
        name: string, 
        description: string, 
        func: ActionFunction, 
        browserContext: boolean = false
    ): void {
        if (this.excludeActions.includes(name)) {
            return;
        }
        
        this.actions.set(name, {
            name,
            description,
            function: func,
            browserContext
        });
    }
    
    /**
     * Execute an action by name with parameters
     * 
     * @param action - Action model containing name and parameters
     * @param browser - Browser instance for actions that need it
     * @returns Action result
     */
    async executeAction(
        action: ActionModel,
        browser?: Browser
    ): Promise<ActionResult> {
        const actionName = action.name;
        const params = action.params || {};
        
        if (!params) {
            throw new Error(`Params are not provided for action: ${actionName}`);
        }
        
        console.log(`Executing action: ${actionName} with params:`, params);
        const actionDef = this.actions.get(actionName);
        
        if (!actionDef) {
            throw new Error(`Action ${actionName} not found`);
        }
        
        try {
            const kwargs: any = { ...params };
            
            // Add browser to kwargs if it's provided and needed
            if (actionDef.browserContext && browser) {
                kwargs.browser = browser;
            }
            
            const result = await actionDef.function(kwargs);
            
            // Validate the result using our schema
            return ActionResultSchema.parse(result);
        } catch (error) {
            console.error(`Error executing action ${actionName}:`, error);
            throw new Error(`Error executing action ${actionName}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * Get descriptions of all registered actions for the LLM prompt
     * 
     * @returns Formatted string of action descriptions
     */
    getActionDescriptions(): string {
        const actionInfo: string[] = [];
        
        this.actions.forEach((action) => {
            // Build parameter info based on function params
            const params: Record<string, any> = {};
            
            // In TypeScript, we can't easily introspect parameters like in Python
            // This could be enhanced with TypeScript reflection libraries or decorators
            // But for now, we'll leave it simple
            
            actionInfo.push(JSON.stringify({
                name: action.name,
                description: action.description,
                parameters: params
            }, null, 2));
        });
        
        return actionInfo.join('\n\n');
    }
}
