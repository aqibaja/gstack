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

export type ExtensionMessage =
  | PreviewStepMessage
  | ClearPreviewMessage
  | ElementSnapshotMessage
  | StepConfirmMessage
  | StepSkipMessage
  | StepSkippedAllMessage
  | AutoExecuteTimeoutMessage
  | UserIntervenedMessage
  | TierConfigMessage;
