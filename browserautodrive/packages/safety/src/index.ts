// BrowserAutoDrive — Safety Layer: ActionValidator + SafetyGuard

import { Action, ElementDescriptor } from "@browserautodrive/core";

const HIGH_STAKES_ACTIONS = new Set(["submit", "purchase", "delete", "confirm"]);
const VALID_ACTION_TYPES = new Set([
  "navigate",
  "click",
  "type",
  "scroll",
  "select",
  "submit",
  "extract",
  "wait",
  "ask_human",
  "done",
]);

const MAX_GOAL_LENGTH = 500;
const MIN_CONFIDENCE = 0.5;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export class ActionValidator {
  validate(action: Action): ValidationResult {
    if (!action) {
      return { valid: false, error: "Action is null or undefined" };
    }

    if (!VALID_ACTION_TYPES.has(action.type)) {
      return {
        valid: false,
        error: `Unknown action type: ${(action as any).type}`,
      };
    }

    switch (action.type) {
      case "navigate":
        if (!action.url) {
          return { valid: false, error: "navigate requires url" };
        }
        if (
          !action.url.startsWith("http://") &&
          !action.url.startsWith("https://")
        ) {
          return {
            valid: false,
            error: "navigate url must start with http:// or https://",
          };
        }
        break;

      case "click":
        if (!action.target) {
          return { valid: false, error: "click requires target element" };
        }
        if (!action.target.selector) {
          return {
            valid: false,
            error: "click target requires selector",
          };
        }
        break;

      case "type":
        if (!action.target) {
          return { valid: false, error: "type requires target element" };
        }
        if (!action.text) {
          return { valid: false, error: "type requires text" };
        }
        break;

      case "scroll":
        if (action.direction !== "up" && action.direction !== "down") {
          return {
            valid: false,
            error: "scroll direction must be 'up' or 'down'",
          };
        }
        break;

      case "select":
        if (!action.target) {
          return { valid: false, error: "select requires target element" };
        }
        if (!action.value) {
          return { valid: false, error: "select requires value" };
        }
        break;

      case "submit":
        if (!action.target) {
          return { valid: false, error: "submit requires target element" };
        }
        break;

      case "extract":
        if (!action.description) {
          return { valid: false, error: "extract requires description" };
        }
        break;

      case "wait":
        if (!action.durationMs || action.durationMs < 0) {
          return {
            valid: false,
            error: "wait requires positive durationMs",
          };
        }
        if (action.durationMs > 30000) {
          return {
            valid: false,
            error: "wait durationMs cannot exceed 30000ms",
          };
        }
        break;

      case "ask_human":
        if (!action.question) {
          return { valid: false, error: "ask_human requires question" };
        }
        break;

      case "done":
        if (action.result === undefined) {
          return { valid: false, error: "done requires result" };
        }
        break;
    }

    return { valid: true };
  }

  validateGoal(goal: string): ValidationResult {
    if (!goal || goal.trim().length === 0) {
      return { valid: false, error: "Goal cannot be empty" };
    }

    if (goal.length > MAX_GOAL_LENGTH) {
      return {
        valid: false,
        error: `Goal exceeds maximum length of ${MAX_GOAL_LENGTH} characters`,
      };
    }

    const suspiciousPatterns = [
      /ignore\s+(previous|above)\s+(instructions|prompt)/i,
      /you\s+are\s+now\s+/i,
      /system\s*:\s*/i,
      /\<\/?system\>/i,
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(goal)) {
        return {
          valid: false,
          error: "Goal contains potentially harmful content",
        };
      }
    }

    return { valid: true };
  }
}

export class SafetyGuard {
  private validator: ActionValidator;

  constructor() {
    this.validator = new ActionValidator();
  }

  isHighStakesAction(action: Action): boolean {
    if (action.type === "submit") return true;
    if (action.type === "click") {
      const description = (action as any).description?.toLowerCase() ?? "";
      const targetText = action.target?.text?.toLowerCase() ?? "";
      return HIGH_STAKES_ACTIONS.has(description) || 
             HIGH_STAKES_ACTIONS.has(targetText);
    }
    return false;
  }

  requiresHumanConfirmation(action: Action): boolean {
    if (this.isHighStakesAction(action)) return true;

    if (action.type === "click" || action.type === "type") {
      const confidence = action.target?.confidence ?? 1.0;
      if (confidence < MIN_CONFIDENCE) return true;
    }

    return false;
  }

  checkConfidence(action: Action): { proceed: boolean; reason?: string } {
    if (action.type === "done") {
      return { proceed: true };
    }
    if (action.type === "ask_human") {
      return { proceed: true };
    }

    if (action.type === "click" || action.type === "type") {
      const confidence = action.target?.confidence ?? 0;
      if (confidence < 0.3) {
        return {
          proceed: false,
          reason: `Confidence ${confidence.toFixed(2)} is too low (minimum 0.3). Requesting human clarification.`,
        };
      }
    }

    return { proceed: true };
  }

  validateAndGate(action: Action): {
    allowed: boolean;
    needsHumanConfirmation: boolean;
    error?: string;
  } {
    const validation = this.validator.validate(action);
    if (!validation.valid) {
      return {
        allowed: false,
        needsHumanConfirmation: false,
        error: validation.error,
      };
    }

    const confidenceCheck = this.checkConfidence(action);
    if (!confidenceCheck.proceed) {
      return {
        allowed: false,
        needsHumanConfirmation: true,
        error: confidenceCheck.reason,
      };
    }

    const needsConfirm = this.requiresHumanConfirmation(action);
    if (needsConfirm) {
      return {
        allowed: true,
        needsHumanConfirmation: true,
      };
    }

    return { allowed: true, needsHumanConfirmation: false };
  }
}