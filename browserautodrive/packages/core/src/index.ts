// BrowserAutoDrive Core — Types, State Machine, and Agent Loop

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ElementDescriptor {
  selector: string;
  text?: string;
  role?: string;
  ariaLabel?: string;
  confidence: number;
}

export interface AccessibilityNode {
  role: string;
  name: string;
  children: AccessibilityNode[];
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface PageSnapshot {
  url: string;
  title: string;
  timestamp: number;
  accessibilityTree: AccessibilityNode;
  interactiveElements: ElementDescriptor[];
  screenshot: string;
  viewportSize: { width: number; height: number };
  scrollPosition: { x: number; y: number };
  formFields?: FormFieldDescriptor[];
}

export interface FormFieldDescriptor {
  selector: string;
  type: string;
  label?: string;
  name?: string;
  value?: string;
  required?: boolean;
}

export type Action =
  | { type: "navigate"; url: string }
  | { type: "click"; target: ElementDescriptor; description: string }
  | { type: "type"; target: ElementDescriptor; text: string; description: string }
  | { type: "scroll"; direction: "up" | "down"; amount: number }
  | { type: "select"; target: ElementDescriptor; value: string; description: string }
  | { type: "submit"; target: ElementDescriptor; description: string }
  | { type: "extract"; description: string; dataType: string }
  | { type: "wait"; durationMs: number; reason: string }
  | { type: "ask_human"; question: string; options?: string[] }
  | { type: "done"; result: string; success: boolean };

export interface StructuredGoal {
  objective: string;
  constraints: string[];
  successCriteria: string;
  origin?: string;
  destination?: string;
  date?: string;
}

export interface ExecutionPlan {
  steps: string[];
  estimatedActions: number;
  goal: StructuredGoal;
}

export interface AgentDecision {
  action: Action;
  reasoning: string;
  confidence: number;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  newState?: PageSnapshot;
}

export interface PromptContext {
  goal: StructuredGoal;
  plan: ExecutionPlan;
  stepIndex: number;
  observation: PageSnapshot;
  history: ActionHistoryEntry[];
  availableActions: string[];
}

export interface ActionHistoryEntry {
  step: number;
  action: Action;
  result: ActionResult;
  timestamp: number;
}

// ─── State Machine ───────────────────────────────────────────────────────────

export type AgentState =
  | "idle"
  | "planning"
  | "executing"
  | "recovering"
  | "human_assist"
  | "complete"
  | "cancelled";

export interface StateTransition {
  from: AgentState;
  to: AgentState;
  event: string;
}

const VALID_TRANSITIONS: StateTransition[] = [
  { from: "idle", to: "planning", event: "goal_start" },
  { from: "planning", to: "executing", event: "plan_ok" },
  { from: "planning", to: "human_assist", event: "plan_fail" },
  { from: "executing", to: "executing", event: "step_ok" },
  { from: "executing", to: "recovering", event: "step_fail" },
  { from: "executing", to: "complete", event: "goal_done" },
  { from: "executing", to: "human_assist", event: "confidence_low" },
  { from: "recovering", to: "executing", event: "retry_ok" },
  { from: "recovering", to: "human_assist", event: "retry_fail" },
  { from: "human_assist", to: "executing", event: "human_resolved" },
  { from: "human_assist", to: "idle", event: "human_cancelled" },
  { from: "idle", to: "cancelled", event: "cancel" },
  { from: "planning", to: "cancelled", event: "cancel" },
  { from: "executing", to: "cancelled", event: "cancel" },
  { from: "recovering", to: "cancelled", event: "cancel" },
];

const MAX_ACTIONS_PER_GOAL = 50;
const MAX_RETRIES = 3;

export class AgentStateMachine {
  private state: AgentState = "idle";
  private actionCount: number = 0;
  private retryCount: number = 0;
  private history: ActionHistoryEntry[] = [];

  getState(): AgentState {
    return this.state;
  }

  getActionCount(): number {
    return this.actionCount;
  }

  getRetryCount(): number {
    return this.retryCount;
  }

  getHistory(): ActionHistoryEntry[] {
    return [...this.history];
  }

  transition(event: string): AgentState {
    const transition = VALID_TRANSITIONS.find(
      (t) => t.from === this.state && t.event === event
    );

    if (!transition) {
      throw new Error(
        `Invalid transition: ${this.state} + ${event} is not allowed`
      );
    }

    this.state = transition.to;
    return this.state;
  }

  recordAction(entry: ActionHistoryEntry): void {
    if (this.actionCount >= MAX_ACTIONS_PER_GOAL) {
      throw new Error(
        `Max actions per goal (${MAX_ACTIONS_PER_GOAL}) exceeded`
      );
    }
    this.actionCount++;
    this.history.push(entry);
  }

  incrementRetry(): void {
    this.retryCount++;
  }

  resetRetryCount(): void {
    this.retryCount = 0;
  }

  isMaxRetriesExceeded(): boolean {
    return this.retryCount >= MAX_RETRIES;
  }

  isMaxActionsExceeded(): boolean {
    return this.actionCount >= MAX_ACTIONS_PER_GOAL;
  }

  reset(): void {
    this.state = "idle";
    this.actionCount = 0;
    this.retryCount = 0;
    this.history = [];
  }
}

export { MAX_ACTIONS_PER_GOAL, MAX_RETRIES };