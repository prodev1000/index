import pino from "pino";
import { ActionModel, ActionResult } from "../agent/models.js";
import { Browser } from "../browser/browser.js";
import { registerDefaultActions } from "./default_actions.js";

const logger = pino({ name: "controller" });

/**
 * Represents a registered action in the controller
 */
export interface Action {
  name: string;
  description: string;
  function: Function;
  browserContext: boolean;
}

/**
 * Parameter type mapping for action parameters
 */
export interface ParameterInfo {
  type: string;
}

/**
 * Controller for browser actions with integrated registry functionality
 */
export class Controller {
  private _actions: Record<string, Action> = {};
  private excludeActions: string[];
  private outputModel: any | null;

  /**
   * Initialize the controller
   * @param excludeActions - Optional list of action names to exclude from registration
   * @param outputModel - Optional model type for action outputs
   */
  constructor(excludeActions: string[] = [], outputModel: any = null) {
    this.excludeActions = excludeActions;
    this.outputModel = outputModel;
    this._actions = {};

    // Register default actions
    registerDefaultActions(this, this.outputModel);
  }

  /**
   * Register an action with the controller
   * @param name - Name of the action
   * @param description - Description of what the action does
   * @param func - The function to execute when the action is called
   * @param browserContext - Whether the function needs browser context
   */
  registerAction(
    name: string,
    description: string,
    func: Function,
    browserContext: boolean = false
  ): void {
    if (this.excludeActions.includes(name)) {
      return;
    }

    this._actions[name] = {
      name,
      description,
      function: func,
      browserContext,
    };
  }

  /**
   * Execute an action from an ActionModel
   * @param action - The action model to execute
   * @param browser - Browser instance for context
   * @returns Result of the action execution
   */
  async executeAction(
    action: ActionModel,
    browser: Browser
  ): Promise<ActionResult> {
    const actionName = action.name;
    const params = action.params || {};

    logger.info({ actionName, params }, "Executing action");

    const registeredAction = this._actions[actionName];

    if (!registeredAction) {
      return new ActionResult({
        isDone: false,
        error: `Action ${actionName} not found`,
      });
    }

    try {
      const kwargs: Record<string, any> = { ...params };

      // Add browser to kwargs if it's needed
      if (registeredAction.browserContext && browser) {
        kwargs["browser"] = browser;
      }

      // Execute the action function with provided parameters
      const result = await registeredAction.function(kwargs);

      if (result instanceof ActionResult) {
        return result;
      } else if (typeof result === "string") {
        return new ActionResult({
          isDone: false,
          content: result,
        });
      } else if (result && typeof result === "object") {
        // Handle results that aren't ActionResult instances but have compatible properties
        return new ActionResult({
          isDone: result.isDone !== undefined ? result.isDone : false,
          content: result.content,
          error: result.error,
          giveControl: result.giveControl,
        });
      }

      // Default return if result is undefined or incompatible
      return new ActionResult({
        isDone: false,
        content: "Action completed with no specific result",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Error executing action ${actionName}: ${message}`);

      return new ActionResult({
        isDone: false,
        error: `Error executing action ${actionName}: ${message}`,
      });
    }
  }

  /**
   * Get descriptions of all registered actions
   * @returns Formatted string of action descriptions
   */
  getActionDescriptions(): string {
    const actionInfo: string[] = [];

    for (const [name, action] of Object.entries(this._actions)) {
      // Get parameter information from function
      const params: Record<string, ParameterInfo> = {};

      // We'll skip detailed parameter typing for now
      // In a more advanced implementation, we could use TypeScript reflection

      actionInfo.push(
        JSON.stringify(
          {
            name,
            description: action.description,
            parameters: params,
          },
          null,
          2
        )
      );
    }

    return actionInfo.join("\n\n");
  }
}
