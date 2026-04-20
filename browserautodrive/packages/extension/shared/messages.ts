export type TierType = "free" | "pro";
export type PopupScreen = "idle" | "preview" | "executing" | "done" | "error";
export type RunStatus = "idle" | "previewing" | "awaiting_confirm" | "executing" | "done" | "failed";
export type ActionType = "click" | "type" | "select" | "navigate" | "scroll" | "wait";

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

export interface PopupRunState {
  goal: string;
  status: RunStatus;
  currentStepIndex: number;
  totalSteps: number;
}

export interface PopupStepState {
  stepId: string;
  stepNumber: number;
  totalSteps: number;
  selector: string;
  action: string;
  value?: string;
  reasoning: string;
}

export interface PopupErrorState {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface PopupViewModel {
  screen: PopupScreen;
  goalDraft: string;
  tier: TierType;
  autoExecuteEnabled: boolean;
  autoExecuteDelayMs: number;
  run: PopupRunState | null;
  step: PopupStepState | null;
  error: PopupErrorState | null;
}

export interface PreviewStepPayload extends PopupStepState {
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

export interface PopupReadyMessage {
  type: "POPUP_READY";
}

export interface PopupStateMessage {
  type: "POPUP_STATE";
  payload: PopupViewModel;
}

export interface PopupErrorMessage {
  type: "POPUP_ERROR";
  payload: PopupErrorState;
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

export interface SetAutoExecuteMessage {
  type: "SET_AUTO_EXECUTE";
  payload: {
    enabled: boolean;
  };
}

export interface ResetPopupMessage {
  type: "RESET_POPUP";
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

export interface ExecuteActionMessage {
  type: "EXECUTE_ACTION";
  payload: {
    stepId: string;
    selector?: string;
    action: ActionType;
    value?: string;
    url?: string;
    timeoutMs?: number;
  };
}

export interface ActionResultMessage {
  type: "ACTION_RESULT";
  payload: {
    stepId: string;
    action: ActionType;
    status: "success" | "failed";
    errorCode?: string;
    errorMessage?: string;
    urlBefore: string;
    urlAfter: string;
    timestamp: number;
    durationMs: number;
    target?: {
      selector?: string;
      tagName?: string;
      text?: string;
    };
  };
}

export type ExtensionMessage =
  | PreviewStepMessage
  | ClearPreviewMessage
  | ElementSnapshotMessage
  | PopupReadyMessage
  | PopupStateMessage
  | PopupErrorMessage
  | StepConfirmMessage
  | StepSkipMessage
  | StepSkippedAllMessage
  | AutoExecuteTimeoutMessage
  | UserIntervenedMessage
  | TierConfigMessage
  | SetAutoExecuteMessage
  | ResetPopupMessage
  | PageMutatedMessage
  | GetSnapshotMessage
  | SnapshotResponseMessage
  | StartObservingMessage
  | StopObservingMessage
  | StartGoalMessage
  | ExecuteActionMessage
  | ActionResultMessage;
