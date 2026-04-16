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

// ─── OODA Agent Loop ─────────────────────────────────────────────────────────

export interface LLMProvider {
  complete(prompt: PromptContext): Promise<AgentDecision>;
  validateApiKey(): Promise<boolean>;
}

export interface BrowserController {
  executeAction(page: any, action: Action): Promise<ActionResult>;
}

export interface ObservationProvider {
  observe(page: any): Promise<PageSnapshot>;
}

export interface SafetyGate {
  validateAndGate(action: Action): {
    allowed: boolean;
    needsHumanConfirmation: boolean;
    error?: string;
  };
}

export interface HumanInterface {
  askQuestion(question: string, options?: string[]): Promise<string>;
  confirmAction(action: Action): Promise<boolean>;
}

export interface AgentLoopResult {
  success: boolean;
  result: string;
  actionsTaken: number;
  history: ActionHistoryEntry[];
  finalState: AgentState;
}

export interface AgentLoopConfig {
  maxActions?: number;
  maxRetries?: number;
  confidenceThreshold?: number;
  pauseOnHumanAssist?: boolean;
}

const DEFAULT_CONFIG: Required<AgentLoopConfig> = {
  maxActions: MAX_ACTIONS_PER_GOAL,
  maxRetries: MAX_RETRIES,
  confidenceThreshold: 0.5,
  pauseOnHumanAssist: true,
};

export class AgentLoop {
  private sm: AgentStateMachine;
  private llm: LLMProvider;
  private browser: BrowserController;
  private observer: ObservationProvider;
  private safety: SafetyGate;
  private human: HumanInterface;
  private config: Required<AgentLoopConfig>;
  private page: any;
  private goal: StructuredGoal | null = null;
  private plan: ExecutionPlan | null = null;
  private actionCount: number = 0;
  private history: ActionHistoryEntry[] = [];

  constructor(deps: {
    llm: LLMProvider;
    browser: BrowserController;
    observer: ObservationProvider;
    safety: SafetyGate;
    human: HumanInterface;
    config?: AgentLoopConfig;
  }) {
    this.sm = new AgentStateMachine();
    this.llm = deps.llm;
    this.browser = deps.browser;
    this.observer = deps.observer;
    this.safety = deps.safety;
    this.human = deps.human;
    this.config = { ...DEFAULT_CONFIG, ...deps.config };
  }

  getState(): AgentState {
    return this.sm.getState();
  }

  getActionCount(): number {
    return this.actionCount;
  }

  getHistory(): ActionHistoryEntry[] {
    return [...this.history];
  }

  private recordAction(entry: ActionHistoryEntry): void {
    this.actionCount++;
    this.history.push(entry);
  }

  async run(
    goal: StructuredGoal,
    page: any,
    plan?: ExecutionPlan
  ): Promise<AgentLoopResult> {
    this.page = page;
    this.goal = goal;
    this.sm.reset();
    this.actionCount = 0;
    this.history = [];

    // Planning phase
    this.sm.transition("goal_start");

    if (plan) {
      this.plan = plan;
    } else {
      this.plan = await this.generatePlan(goal);
    }

    if (!this.plan) {
      this.sm.transition("plan_fail");
      return {
        success: false,
        result: "Failed to generate execution plan",
        actionsTaken: 0,
        history: this.history,
        finalState: this.sm.getState(),
      };
    }

    this.sm.transition("plan_ok");

    // Execution loop
    let stepIndex = 0;
    while (this.sm.getState() === "executing" || this.sm.getState() === "recovering") {
      if (this.actionCount >= this.config.maxActions) {
        return {
          success: false,
          result: `Max actions (${this.config.maxActions}) exceeded without completing goal`,
          actionsTaken: this.actionCount,
          history: this.history,
          finalState: "complete",
        };
      }

      try {
        const shouldContinue = await this.executeStep(stepIndex);
        if (!shouldContinue) break;
        stepIndex++;
        this.sm.resetRetryCount();
      } catch (error) {
        const handled = await this.handleStepError(error, stepIndex);
        if (!handled) break;
      }
    }

    const state = this.sm.getState();
    return {
      success: state === "complete",
      result: this.getLastResult(),
      actionsTaken: this.actionCount,
      history: this.history,
      finalState: state,
    };
  }

  cancel(): void {
    try {
      this.sm.transition("cancel");
    } catch {
      // Already in a state that can't cancel
    }
  }

  private async executeStep(stepIndex: number): Promise<boolean> {
    // OBSERVE
    const observation = await this.observer.observe(this.page);

    // ORIENT + DECIDE
    const decision = await this.llm.complete({
      goal: this.goal!,
      plan: this.plan!,
      stepIndex,
      observation,
      history: this.history.slice(-5),
      availableActions: [
        "navigate", "click", "type", "scroll", "select",
        "submit", "extract", "wait", "ask_human", "done",
      ],
    });

    // Safety check
    const gateResult = this.safety.validateAndGate(decision.action);
    if (!gateResult.allowed) {
      if (decision.confidence < this.config.confidenceThreshold) {
        this.sm.transition("confidence_low");
        const resolution = await this.handleHumanAssist(
          `Safety gate blocked action: ${gateResult.error}. Agent confidence was ${decision.confidence.toFixed(2)}. How should I proceed?`
        );
        if (resolution === "cancel") return false;
        return true; // retry
      }
      this.sm.transition("step_fail");
      throw new Error(gateResult.error || "Action blocked by safety gate");
    }

    if (gateResult.needsHumanConfirmation) {
      const confirmed = await this.human.confirmAction(decision.action);
      if (!confirmed) {
        this.sm.transition("confidence_low");
        const resolution = await this.handleHumanAssist(
          `High-stakes action "${decision.action.type}" was rejected by human. How should I proceed?`
        );
        if (resolution === "cancel") return false;
        return true;
      }
    }

    // Check if goal is done
    if (decision.action.type === "done") {
      const entry: ActionHistoryEntry = {
        step: stepIndex,
        action: decision.action,
        result: { success: decision.action.success },
        timestamp: Date.now(),
      };
      this.recordAction(entry);
      this.sm.transition("goal_done");
      return false;
    }

    // ACT
    let actionResult: ActionResult;
    try {
      actionResult = await this.browser.executeAction(this.page, decision.action);
    } catch (err: unknown) {
      actionResult = {
        success: false,
        error: err instanceof Error ? err.message : "Browser action threw",
      };
    }

    const entry: ActionHistoryEntry = {
      step: stepIndex,
      action: decision.action,
      result: actionResult,
      timestamp: Date.now(),
    };
    this.recordAction(entry);

    if (!actionResult.success) {
      this.sm.transition("step_fail");
      throw new Error(actionResult.error || "Action failed");
    }

    this.sm.transition("step_ok");
    return true;
  }

  private async handleStepError(error: unknown, stepIndex: number): Promise<boolean> {
    this.sm.incrementRetry();

    if (this.sm.isMaxRetriesExceeded()) {
      if (this.sm.getState() === "recovering") {
        this.sm.transition("retry_fail");
      } else {
        this.sm.transition("step_fail");
        this.sm.transition("retry_fail");
      }

      const resolution = await this.handleHumanAssist(
        `Action failed after ${this.config.maxRetries} retries: ${error instanceof Error ? error.message : "unknown error"}. How should I proceed?`
      );
      return resolution !== "cancel";
    }

    if (this.sm.getState() === "executing") {
      this.sm.transition("step_fail");
    }

    if (this.sm.getState() === "recovering") {
      // Re-observe and retry
      try {
        await this.observer.observe(this.page);
        this.sm.transition("retry_ok");
        return true;
      } catch {
        return false;
      }
    }

    return true;
  }

  private async handleHumanAssist(question: string): Promise<string> {
    if (this.config.pauseOnHumanAssist) {
      if (this.sm.getState() !== "human_assist") {
        try {
          this.sm.transition("confidence_low");
        } catch {
          // already transitioning
        }
      }

      const response = await this.human.askQuestion(question, [
        "Continue",
        "Retry with different approach",
        "Cancel",
      ]);

      if (response === "Cancel") {
        this.sm.transition("human_cancelled");
        return "cancel";
      }

      this.sm.transition("human_resolved");
      this.sm.resetRetryCount();
      return response === "Retry with different approach" ? "retry" : "continue";
    }

    return "continue";
  }

  private async generatePlan(goal: StructuredGoal): Promise<ExecutionPlan | null> {
    // Use the LLM to generate a plan from the goal
    // This is a simplified plan generation — Week 3 will enhance with GoalParser
    const steps = goal.objective
      .split(/[.,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    return {
      steps: steps.length > 0 ? steps : [goal.objective],
      estimatedActions: Math.max(steps.length * 2, 5),
      goal,
    };
  }

  private getLastResult(): string {
    const history = this.history;
    if (history.length === 0) return "No actions taken";

    const lastEntry = history[history.length - 1];
    if (lastEntry.action.type === "done") {
      return lastEntry.action.result;
    }

    return lastEntry.result.success
      ? `Last action succeeded: ${lastEntry.action.type}`
      : `Last action failed: ${lastEntry.result.error || "unknown error"}`;
  }
}

export { MAX_ACTIONS_PER_GOAL, MAX_RETRIES };