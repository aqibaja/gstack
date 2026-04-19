// BrowserAutoDrive Extension — Shared Message Types

export type TierType = "free" | "pro";

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
}

export interface ElementSnapshot {
  elementRect: ElementRect;
  tagName: string;
  text: string;
  ariaLabel: string;
}

export interface PreviewStepPayload {
  stepId: string;
  stepNumber: number;
  totalSteps: number;
  selector: string;
  action: string;
  value?: string;
  reasoning: string;
  tier: TierType;
}

export interface PreviewStepMessage {
  type: "PREVIEW_STEP";
  payload: PreviewStepPayload;
}

export interface ClearPreviewMessage {
  type: "CLEAR_PREVIEW";
  payload?: {
    done?: boolean;
  };
}

export interface ElementSnapshotMessage {
  type: "ELEMENT_SNAPSHOT";
  payload: {
    stepId: string;
    snapshot: ElementSnapshot | null;
  };
}

export interface StepConfirmMessage {
  type: "STEP_CONFIRM";
  payload: {
    stepId: string;
  };
}

export interface StepSkipMessage {
  type: "STEP_SKIP";
  payload: {
    stepId: string;
  };
}

export interface StepSkippedAllMessage {
  type: "STEP_SKIP_ALL";
  payload: {
    stepId: string;
  };
}

export interface AutoExecuteTimeoutMessage {
  type: "AUTO_EXECUTE_TIMEOUT";
  payload: {
    stepId: string;
  };
}

export interface UserIntervenedMessage {
  type: "USER_INTERVENED";
  payload: {
    stepId: string;
  };
}

export interface TierConfigMessage {
  type: "TIER_CONFIG";
  payload: {
    tier: TierType;
    autoExecute: boolean;
    autoExecuteDelayMs: number;
  };
}

export interface DOMAccessibilityNode {
  role: string;
  name: string;
  children: DOMAccessibilityNode[];
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface DOMElementDescriptor {
  selector: string;
  text?: string;
  role?: string;
  ariaLabel?: string;
  confidence: number;
}

export interface DOMFormFieldDescriptor {
  selector: string;
  type: string;
  label?: string;
  name?: string;
  value?: string;
  required?: boolean;
}

export interface DOMSnapshotPayload {
  accessibilityTree: DOMAccessibilityNode;
  interactiveElements: DOMElementDescriptor[];
  formFields: DOMFormFieldDescriptor[];
  url: string;
  title: string;
  timestamp: number;
  viewportSize: { width: number; height: number };
  scrollPosition: { x: number; y: number };
}

export interface PageMutatedMessage {
  type: "PAGE_MUTATED";
  payload: {
    url: string;
    title: string;
    timestamp: number;
  };
}

export interface GetSnapshotMessage {
  type: "GET_SNAPSHOT";
  payload?: Record<string, never>;
}

export interface SnapshotResponseMessage {
  type: "SNAPSHOT_RESPONSE";
  payload: DOMSnapshotPayload;
}

export interface StartObservingMessage {
  type: "START_OBSERVING";
  payload?: Record<string, never>;
}

export interface StopObservingMessage {
  type: "STOP_OBSERVING";
  payload?: Record<string, never>;
}

export interface StartGoalMessage {
  type: "START_GOAL";
  payload: {
    goal: string;
  };
}

export type ExtensionMessage =
  | PreviewStepMessage
  | ClearPreviewMessage
  | ElementSnapshotMessage
  | StepConfirmMessage
  | StepSkipMessage
  | StepSkippedAllMessage
  | AutoExecuteTimeoutMessage
  | UserIntervenedMessage
  | TierConfigMessage
  | PageMutatedMessage
  | GetSnapshotMessage
  | SnapshotResponseMessage
  | StartObservingMessage
  | StopObservingMessage
  | StartGoalMessage;
