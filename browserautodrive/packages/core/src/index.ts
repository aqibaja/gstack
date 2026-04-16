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

export interface ProgressEvent {
  type: "planning" | "observing" | "deciding" | "acting" | "recovering" | "human_assist" | "complete" | "error";
  stepIndex: number;
  message: string;
  timestamp: number;
  action?: Action;
  result?: ActionResult;
}

export type ProgressCallback = (event: ProgressEvent) => void;

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
  private memory: SessionMemory;
  private onProgress: ProgressCallback | null;
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
    onProgress?: ProgressCallback;
  }) {
    this.sm = new AgentStateMachine();
    this.llm = deps.llm;
    this.browser = deps.browser;
    this.observer = deps.observer;
    this.safety = deps.safety;
    this.human = deps.human;
    this.config = { ...DEFAULT_CONFIG, ...deps.config };
    this.memory = new SessionMemory();
    this.onProgress = deps.onProgress ?? null;
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

  getSessionState(): SessionState | null {
    return this.memory.getState();
  }

  private emitProgress(type: ProgressEvent["type"], stepIndex: number, message: string, extras?: Partial<ProgressEvent>): void {
    if (this.onProgress) {
      this.onProgress({
        type,
        stepIndex,
        message,
        timestamp: Date.now(),
        ...extras,
      });
    }
  }

  private recordAction(entry: ActionHistoryEntry): void {
    this.actionCount++;
    this.history.push(entry);
    this.memory.recordAction(entry);
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
    this.emitProgress("planning", 0, "Generating execution plan...");

    if (plan) {
      this.plan = plan;
    } else {
      this.plan = this.generatePlanFromGoal(goal);
    }

    if (!this.plan) {
      this.sm.transition("plan_fail");
      this.emitProgress("error", 0, "Failed to generate execution plan");
      return {
        success: false,
        result: "Failed to generate execution plan",
        actionsTaken: 0,
        history: this.history,
        finalState: this.sm.getState(),
      };
    }

    this.sm.transition("plan_ok");
    this.memory.init(goal, this.plan);
    this.emitProgress("planning", 0, `Plan generated: ${this.plan.steps.length} steps, ~${this.plan.estimatedActions} actions`);

    // Execution loop
    let stepIndex = 0;
    while (this.sm.getState() === "executing" || this.sm.getState() === "recovering") {
      if (this.actionCount >= this.config.maxActions) {
        this.emitProgress("error", stepIndex, `Max actions (${this.config.maxActions}) exceeded`);
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
    if (state === "complete") {
      this.emitProgress("complete", stepIndex, this.getLastResult());
    }
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
    this.emitProgress("observing", stepIndex, "Observing page state...");
    const observation = await this.observer.observe(this.page);

    // ORIENT + DECIDE
    this.emitProgress("deciding", stepIndex, "LLM deciding next action...");
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
        this.emitProgress("human_assist", stepIndex, `Safety blocked: ${gateResult.error}. Confidence ${decision.confidence.toFixed(2)}`);
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
        this.emitProgress("human_assist", stepIndex, `Human rejected high-stakes action: ${decision.action.type}`);
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
    this.emitProgress("acting", stepIndex, `Executing: ${decision.action.type}`, { action: decision.action });
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
      this.emitProgress("error", stepIndex, `Action failed: ${actionResult.error}`, { result: actionResult });
      throw new Error(actionResult.error || "Action failed");
    }

    this.sm.transition("step_ok");
    this.emitProgress("acting", stepIndex, `Step ${stepIndex + 1} succeeded: ${decision.action.type}`, { result: actionResult });
    return true;
  }

  private async handleStepError(error: unknown, stepIndex: number): Promise<boolean> {
    this.sm.incrementRetry();
    this.emitProgress("recovering", stepIndex, `Step failed (retry ${this.sm.getRetryCount()}/${this.config.maxRetries}): ${error instanceof Error ? error.message : "unknown error"}`);

    if (this.sm.isMaxRetriesExceeded()) {
      if (this.sm.getState() === "recovering") {
        this.sm.transition("retry_fail");
      } else {
        this.sm.transition("step_fail");
        this.sm.transition("retry_fail");
      }

      this.emitProgress("human_assist", stepIndex, `Max retries exceeded, requesting human assistance`);
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
        this.emitProgress("recovering", stepIndex, "Retry succeeded, continuing execution");
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

  private generatePlanFromGoal(goal: StructuredGoal): ExecutionPlan | null {
    try {
      const planner = new Planner();
      return planner.createPlan(goal);
    } catch {
      return null;
    }
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

// ─── GoalParser ──────────────────────────────────────────────────────────────

export interface GoalParseResult {
  goal: StructuredGoal;
  ambiguities: string[];
  warnings: string[];
}

const MAX_GOAL_INPUT_LENGTH = 500;

const INJECTION_PATTERNS = [
  /ignore\s+(previous|above)\s+(instructions|prompt)/i,
  /you\s+are\s+now\s+/i,
  /system\s*:\s*/i,
  /<\/?system>/i,
  /disregard\s+(all\s+)?(previous|prior)\s+/i,
  /new\s+instructions?\s*:/i,
];

const AMBIGUITY_INDICATORS = [
  { pattern: /\bor\b/i, hint: "Goal contains 'or' — may indicate unclear intent" },
  { pattern: /\bmaybe\b/i, hint: "Goal contains 'maybe' — uncertain intent" },
  { pattern: /\bsome(?:thing|one)?\b/i, hint: "Goal contains vague reference" },
  { pattern: /\b(?:not sure|unsure)\b/i, hint: "Goal expresses uncertainty" },
];

export class GoalParser {
  parse(rawInput: string): GoalParseResult {
    const trimmed = rawInput.trim();

    if (!trimmed) {
      throw new Error("Goal cannot be empty");
    }

    if (trimmed.length > MAX_GOAL_INPUT_LENGTH) {
      throw new Error(
        `Goal exceeds maximum length of ${MAX_GOAL_INPUT_LENGTH} characters (${trimmed.length})`
      );
    }

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(trimmed)) {
        throw new Error("Goal contains potentially harmful content and cannot be processed");
      }
    }

    const ambiguities: string[] = [];
    const warnings: string[] = [];

    for (const { pattern, hint } of AMBIGUITY_INDICATORS) {
      if (pattern.test(trimmed)) {
        ambiguities.push(hint);
      }
    }

    if (!/[.!?]$/.test(trimmed)) {
      warnings.push("Goal does not end with punctuation — intent may be unclear");
    }

    if (trimmed.split(/\s+/).length < 3) {
      warnings.push("Goal is very short — may lack sufficient detail for reliable execution");
    }

    const goal = this.extractStructuredGoal(trimmed);

    return { goal, ambiguities, warnings };
  }

  private extractStructuredGoal(input: string): StructuredGoal {
    const objective = input;

    const constraints: string[] = [];
    const constraintMatch = input.match(/\b(?:without|don't|do not|never|avoid|no)\s+(.+?)(?:[,.;]|$)/gi);
    if (constraintMatch) {
      for (const m of constraintMatch) {
        constraints.push(m.trim());
      }
    }

    const origin = this.extractEntity(input, /(?:from|departing|leaving)\s+([A-Z]{3}|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/i);
    const destination = this.extractEntity(input, /(?:to|arriving|heading)\s+([A-Z]{3}|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/i);
    const date = this.extractEntity(input, /(?:on|for|by)\s+(\d{4}-\d{2}-\d{2}|\w+\s+\d{1,2}(?:st|nd|rd|th)?)/i);

    const successCriteria = this.inferSuccessCriteria(input);

    return {
      objective,
      constraints,
      successCriteria,
      ...(origin && { origin }),
      ...(destination && { destination }),
      ...(date && { date }),
    };
  }

  private extractEntity(input: string, pattern: RegExp): string | undefined {
    const match = input.match(pattern);
    return match?.[1];
  }

  private inferSuccessCriteria(input: string): string {
    const lower = input.toLowerCase();

    if (/book|purchase|buy|reserve|order/i.test(lower)) {
      return "Transaction completed successfully";
    }
    if (/search|find|look\s+up|locate/i.test(lower)) {
      return "Results found and displayed";
    }
    if (/fill|complete|submit|form/i.test(lower)) {
      return "Form submitted without errors";
    }
    if (/navigate|go\s+to|open|visit/i.test(lower)) {
      return "Target page loaded successfully";
    }
    if (/extract|scrape|get|fetch|collect/i.test(lower)) {
      return "Data extracted successfully";
    }

    return "Goal objective achieved";
  }
}

// ─── Planner ─────────────────────────────────────────────────────────────────

export interface PlanStep {
  index: number;
  description: string;
  targetUrl?: string;
  actionHint?: string;
  dependsOn?: number[];
}

export class Planner {
  createPlan(goal: StructuredGoal): ExecutionPlan {
    const steps = this.decomposeGoal(goal);
    const estimatedActions = this.estimateActions(steps);

    return {
      steps: steps.map((s) => s.description),
      estimatedActions,
      goal,
    };
  }

  createDetailedPlan(goal: StructuredGoal): { plan: ExecutionPlan; steps: PlanStep[] } {
    const steps = this.decomposeGoal(goal);
    const estimatedActions = this.estimateActions(steps);
    const planSteps = steps.map((s, i) => ({
      index: i,
      description: s.description,
      ...(s.targetUrl && { targetUrl: s.targetUrl }),
      ...(s.actionHint && { actionHint: s.actionHint }),
      ...(i > 0 && { dependsOn: [i - 1] }),
    }));

    return {
      plan: {
        steps: steps.map((s) => s.description),
        estimatedActions,
        goal,
      },
      steps: planSteps,
    };
  }

  private decomposeGoal(goal: StructuredGoal): PlanStep[] {
    const steps: PlanStep[] = [];
    const lower = goal.objective.toLowerCase();

    if (/navigate|go\s+to|open|visit/i.test(lower)) {
      const urlMatch = goal.objective.match(/(https?:\/\/[^\s,]+)/i);
      if (urlMatch) {
        steps.push({
          index: 0,
          description: `Navigate to ${urlMatch[0]}`,
          targetUrl: urlMatch[0],
          actionHint: "navigate",
        });
      }
    }

    if (goal.origin && goal.destination) {
      steps.push({
        index: steps.length,
        description: `Navigate to travel booking site`,
        actionHint: "navigate",
      });
      steps.push({
        index: steps.length,
        description: `Enter origin: ${goal.origin}`,
        actionHint: "type",
      });
      steps.push({
        index: steps.length,
        description: `Enter destination: ${goal.destination}`,
        actionHint: "type",
      });
      if (goal.date) {
        steps.push({
          index: steps.length,
          description: `Select date: ${goal.date}`,
          actionHint: "type",
        });
      }
      steps.push({
        index: steps.length,
        description: "Submit search",
        actionHint: "submit",
      });
      steps.push({
        index: steps.length,
        description: "Select first available option",
        actionHint: "click",
      });
    } else if (/book|purchase|buy|reserve|order/i.test(lower)) {
      steps.push({
        index: steps.length,
        description: "Navigate to the service website",
        actionHint: "navigate",
      });
      steps.push({
        index: steps.length,
        description: "Locate and fill in required form fields",
        actionHint: "type",
      });
      steps.push({
        index: steps.length,
        description: "Submit the booking/purchase form",
        actionHint: "submit",
      });
    } else if (/search|find|look\s+up|locate/i.test(lower)) {
      steps.push({
        index: steps.length,
        description: "Navigate to search page",
        actionHint: "navigate",
      });
      steps.push({
        index: steps.length,
        description: "Enter search query",
        actionHint: "type",
      });
      steps.push({
        index: steps.length,
        description: "Review search results",
        actionHint: "extract",
      });
    } else if (/fill|complete|submit|form/i.test(lower)) {
      steps.push({
        index: steps.length,
        description: "Navigate to form page",
        actionHint: "navigate",
      });
      steps.push({
        index: steps.length,
        description: "Fill in all required form fields",
        actionHint: "type",
      });
      steps.push({
        index: steps.length,
        description: "Submit the form",
        actionHint: "submit",
      });
    } else if (/extract|scrape|get|fetch|collect/i.test(lower)) {
      steps.push({
        index: steps.length,
        description: "Navigate to target page",
        actionHint: "navigate",
      });
      steps.push({
        index: steps.length,
        description: "Extract required data",
        actionHint: "extract",
      });
    }

    if (steps.length === 0) {
      steps.push({
        index: 0,
        description: goal.objective,
      });
    }

    steps.push({
      index: steps.length,
      description: "Verify goal completion",
      actionHint: "done",
    });

    return steps;
  }

  private estimateActions(steps: PlanStep[]): number {
    return steps.reduce((total, step) => {
      switch (step.actionHint) {
        case "navigate": return total + 1;
        case "type": return total + 2;
        case "click": return total + 1;
        case "submit": return total + 1;
        case "extract": return total + 2;
        default: return total + 2;
      }
    }, 0);
  }
}

// ─── Session Memory ──────────────────────────────────────────────────────────

export interface SessionState {
  goal: StructuredGoal;
  plan: ExecutionPlan;
  stepIndex: number;
  history: ActionHistoryEntry[];
  startedAt: number;
  updatedAt: number;
}

export class SessionMemory {
  private state: SessionState | null = null;

  init(goal: StructuredGoal, plan: ExecutionPlan): void {
    this.state = {
      goal,
      plan,
      stepIndex: 0,
      history: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  recordAction(entry: ActionHistoryEntry): void {
    if (!this.state) throw new Error("Session not initialized");
    this.state.history.push(entry);
    this.state.stepIndex = entry.step + 1;
    this.state.updatedAt = Date.now();
  }

  getState(): SessionState | null {
    return this.state ? { ...this.state } : null;
  }

  getRecentHistory(count: number = 5): ActionHistoryEntry[] {
    if (!this.state) return [];
    return this.state.history.slice(-count);
  }

  getElapsedTime(): number {
    if (!this.state) return 0;
    return Date.now() - this.state.startedAt;
  }

  reset(): void {
    this.state = null;
  }
}

export { MAX_ACTIONS_PER_GOAL, MAX_GOAL_INPUT_LENGTH, MAX_RETRIES };