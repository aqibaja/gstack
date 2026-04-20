// BrowserAutoDrive — Message Validator
// Validates messages against shared types and schemas.

import type {
  ExtensionMessage,
  PreviewStepMessage,
  ClearPreviewMessage,
  ElementSnapshotMessage,
  StepConfirmMessage,
  StepSkipMessage,
  StepSkippedAllMessage,
  AutoExecuteTimeoutMessage,
  UserIntervenedMessage,
  TierConfigMessage,
  PageMutatedMessage,
  GetSnapshotMessage,
  SnapshotResponseMessage,
  StartObservingMessage,
  StopObservingMessage,
  StartGoalMessage,
  ElementRect,
  ElementSnapshot,
  PreviewStepPayload,
  TierType,
} from "../shared/messages";

// ─── Validation Functions ────────────────────────────────────────────────────

export function validateElementRect(rect: unknown): rect is ElementRect {
  if (!rect || typeof rect !== "object") return false;

  const r = rect as Record<string, unknown>;

  return (
    typeof r.x === "number" &&
    typeof r.y === "number" &&
    typeof r.width === "number" &&
    typeof r.height === "number" &&
    typeof r.top === "number" &&
    typeof r.left === "number" &&
    isFinite(r.x) &&
    isFinite(r.y) &&
    isFinite(r.width) &&
    isFinite(r.height) &&
    isFinite(r.top) &&
    isFinite(r.left)
  );
}

export function validateElementSnapshot(snapshot: unknown): snapshot is ElementSnapshot {
  if (!snapshot || typeof snapshot !== "object") return false;

  const s = snapshot as Record<string, unknown>;

  return (
    validateElementRect(s.elementRect) &&
    typeof s.tagName === "string" &&
    typeof s.text === "string" &&
    typeof s.ariaLabel === "string"
  );
}

export function validateTierType(tier: unknown): tier is TierType {
  return tier === "free" || tier === "pro";
}

export function validatePreviewStepPayload(payload: unknown): payload is PreviewStepPayload {
  if (!payload || typeof payload !== "object") return false;

  const p = payload as Record<string, unknown>;

  return (
    typeof p.stepId === "string" &&
    p.stepId.length > 0 &&
    typeof p.stepNumber === "number" &&
    Number.isInteger(p.stepNumber) &&
    p.stepNumber > 0 &&
    typeof p.totalSteps === "number" &&
    Number.isInteger(p.totalSteps) &&
    p.totalSteps > 0 &&
    typeof p.selector === "string" &&
    p.selector.length > 0 &&
    typeof p.action === "string" &&
    p.action.length > 0 &&
    typeof p.reasoning === "string" &&
    validateTierType(p.tier)
  );
}

// ─── Message Validators ─────────────────────────────────────────────────────

export function validatePreviewStepMessage(message: unknown): message is PreviewStepMessage {
  if (!message || typeof message !== "object") return false;

  const m = message as Record<string, unknown>;

  return m.type === "PREVIEW_STEP" && validatePreviewStepPayload(m.payload);
}

export function validateClearPreviewMessage(message: unknown): message is ClearPreviewMessage {
  if (!message || typeof message !== "object") return false;

  const m = message as Record<string, unknown>;

  if (m.type !== "CLEAR_PREVIEW") return false;
  if (m.payload === undefined) return true;
  if (!m.payload || typeof m.payload !== "object") return false;

  const payload = m.payload as Record<string, unknown>;
  return payload.done === undefined || typeof payload.done === "boolean";
}

export function validateElementSnapshotMessage(message: unknown): message is ElementSnapshotMessage {
  if (!message || typeof message !== "object") return false;

  const m = message as Record<string, unknown>;

  if (m.type !== "ELEMENT_SNAPSHOT") return false;

  const payload = m.payload as Record<string, unknown> | undefined;

  return (
    payload !== undefined &&
    typeof payload.stepId === "string" &&
    payload.stepId.length > 0 &&
    (payload.snapshot === null || validateElementSnapshot(payload.snapshot))
  );
}

export function validateStepConfirmMessage(message: unknown): message is StepConfirmMessage {
  if (!message || typeof message !== "object") return false;

  const m = message as Record<string, unknown>;

  if (m.type !== "STEP_CONFIRM") return false;

  const payload = m.payload as Record<string, unknown> | undefined;

  return payload !== undefined && typeof payload.stepId === "string" && payload.stepId.length > 0;
}

export function validateStepSkipMessage(message: unknown): message is StepSkipMessage {
  if (!message || typeof message !== "object") return false;

  const m = message as Record<string, unknown>;

  if (m.type !== "STEP_SKIP") return false;

  const payload = m.payload as Record<string, unknown> | undefined;

  return payload !== undefined && typeof payload.stepId === "string" && payload.stepId.length > 0;
}

export function validateStepSkippedAllMessage(message: unknown): message is StepSkippedAllMessage {
  if (!message || typeof message !== "object") return false;

  const m = message as Record<string, unknown>;

  if (m.type !== "STEP_SKIP_ALL") return false;

  const payload = m.payload as Record<string, unknown> | undefined;

  return payload !== undefined && typeof payload.stepId === "string" && payload.stepId.length > 0;
}

export function validateAutoExecuteTimeoutMessage(message: unknown): message is AutoExecuteTimeoutMessage {
  if (!message || typeof message !== "object") return false;

  const m = message as Record<string, unknown>;

  if (m.type !== "AUTO_EXECUTE_TIMEOUT") return false;

  const payload = m.payload as Record<string, unknown> | undefined;

  return payload !== undefined && typeof payload.stepId === "string" && payload.stepId.length > 0;
}

export function validateUserIntervenedMessage(message: unknown): message is UserIntervenedMessage {
  if (!message || typeof message !== "object") return false;

  const m = message as Record<string, unknown>;

  if (m.type !== "USER_INTERVENED") return false;

  const payload = m.payload as Record<string, unknown> | undefined;

  return payload !== undefined && typeof payload.stepId === "string" && payload.stepId.length > 0;
}

export function validateTierConfigMessage(message: unknown): message is TierConfigMessage {
  if (!message || typeof message !== "object") return false;

  const m = message as Record<string, unknown>;

  if (m.type !== "TIER_CONFIG") return false;

  const payload = m.payload as Record<string, unknown> | undefined;

  return (
    payload !== undefined &&
    validateTierType(payload.tier) &&
    typeof payload.autoExecute === "boolean" &&
    typeof payload.autoExecuteDelayMs === "number" &&
    Number.isInteger(payload.autoExecuteDelayMs) &&
    payload.autoExecuteDelayMs >= 0
  );
}

export function validatePageMutatedMessage(message: unknown): message is PageMutatedMessage {
  if (!message || typeof message !== "object") return false;

  const m = message as Record<string, unknown>;
  if (m.type !== "PAGE_MUTATED") return false;

  const payload = m.payload as Record<string, unknown> | undefined;
  return (
    payload !== undefined &&
    typeof payload.url === "string" &&
    typeof payload.title === "string" &&
    typeof payload.timestamp === "number"
  );
}

export function validateGetSnapshotMessage(message: unknown): message is GetSnapshotMessage {
  if (!message || typeof message !== "object") return false;

  return (message as Record<string, unknown>).type === "GET_SNAPSHOT";
}

export function validateSnapshotResponseMessage(message: unknown): message is SnapshotResponseMessage {
  if (!message || typeof message !== "object") return false;

  const m = message as Record<string, unknown>;
  if (m.type !== "SNAPSHOT_RESPONSE") return false;

  const payload = m.payload as Record<string, unknown> | undefined;
  return (
    payload !== undefined &&
    typeof payload.url === "string" &&
    typeof payload.title === "string" &&
    typeof payload.timestamp === "number" &&
    Array.isArray(payload.interactiveElements) &&
    Array.isArray(payload.formFields)
  );
}

export function validateStartObservingMessage(message: unknown): message is StartObservingMessage {
  if (!message || typeof message !== "object") return false;

  return (message as Record<string, unknown>).type === "START_OBSERVING";
}

export function validateStopObservingMessage(message: unknown): message is StopObservingMessage {
  if (!message || typeof message !== "object") return false;

  return (message as Record<string, unknown>).type === "STOP_OBSERVING";
}

export function validateStartGoalMessage(message: unknown): message is StartGoalMessage {
  if (!message || typeof message !== "object") return false;

  const m = message as Record<string, unknown>;
  if (m.type !== "START_GOAL") return false;

  const payload = m.payload as Record<string, unknown> | undefined;
  return payload !== undefined && typeof payload.goal === "string" && payload.goal.trim().length > 0;
}

// ─── Main Validator ──────────────────────────────────────────────────────────

export function validateExtensionMessage(message: unknown): message is ExtensionMessage {
  if (!message || typeof message !== "object") return false;

  const m = message as Record<string, unknown>;

  if (typeof m.type !== "string") return false;

  switch (m.type) {
    case "PREVIEW_STEP":
      return validatePreviewStepMessage(message);
    case "CLEAR_PREVIEW":
      return validateClearPreviewMessage(message);
    case "ELEMENT_SNAPSHOT":
      return validateElementSnapshotMessage(message);
    case "STEP_CONFIRM":
      return validateStepConfirmMessage(message);
    case "STEP_SKIP":
      return validateStepSkipMessage(message);
    case "STEP_SKIP_ALL":
      return validateStepSkippedAllMessage(message);
    case "AUTO_EXECUTE_TIMEOUT":
      return validateAutoExecuteTimeoutMessage(message);
    case "USER_INTERVENED":
      return validateUserIntervenedMessage(message);
    case "TIER_CONFIG":
      return validateTierConfigMessage(message);
    case "PAGE_MUTATED":
      return validatePageMutatedMessage(message);
    case "GET_SNAPSHOT":
      return validateGetSnapshotMessage(message);
    case "SNAPSHOT_RESPONSE":
      return validateSnapshotResponseMessage(message);
    case "START_OBSERVING":
      return validateStartObservingMessage(message);
    case "STOP_OBSERVING":
      return validateStopObservingMessage(message);
    case "START_GOAL":
      return validateStartGoalMessage(message);
    default:
      return false;
  }
}

// ─── Validation Error Messages ───────────────────────────────────────────────

export function getValidationErrorMessage(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return "Message must be an object";
  }

  const m = message as Record<string, unknown>;

  if (typeof m.type !== "string") {
    return "Message must have a string 'type' field";
  }

  if (!("payload" in m) && !["CLEAR_PREVIEW", "GET_SNAPSHOT", "START_OBSERVING", "STOP_OBSERVING"].includes(m.type)) {
    return "Message must have a 'payload' field";
  }

  switch (m.type) {
    case "PREVIEW_STEP":
      if (!validatePreviewStepPayload(m.payload)) {
        return "Invalid PREVIEW_STEP payload: missing or invalid stepId, stepNumber, totalSteps, selector, action, reasoning, or tier";
      }
      break;

    case "ELEMENT_SNAPSHOT":
      const snapshotPayload = m.payload as Record<string, unknown> | undefined;
      if (!snapshotPayload || typeof snapshotPayload.stepId !== "string") {
        return "Invalid ELEMENT_SNAPSHOT payload: missing stepId";
      }
      if (snapshotPayload.snapshot !== null && !validateElementSnapshot(snapshotPayload.snapshot)) {
        return "Invalid ELEMENT_SNAPSHOT payload: invalid snapshot structure";
      }
      break;

    case "STEP_CONFIRM":
    case "STEP_SKIP":
    case "STEP_SKIP_ALL":
    case "AUTO_EXECUTE_TIMEOUT":
    case "USER_INTERVENED":
      const stepPayload = m.payload as Record<string, unknown> | undefined;
      if (!stepPayload || typeof stepPayload.stepId !== "string") {
        return `Invalid ${m.type} payload: missing stepId`;
      }
      break;

    case "TIER_CONFIG":
      if (!validateTierConfigMessage(message)) {
        return "Invalid TIER_CONFIG payload: missing or invalid tier, autoExecute, or autoExecuteDelayMs";
      }
      break;

    case "CLEAR_PREVIEW":
      if (!validateClearPreviewMessage(message)) {
        return "Invalid CLEAR_PREVIEW payload";
      }
      break;

    case "START_GOAL":
      if (!validateStartGoalMessage(message)) {
        return "Invalid START_GOAL payload: missing goal";
      }
      break;

    case "PAGE_MUTATED":
      if (!validatePageMutatedMessage(message)) {
        return "Invalid PAGE_MUTATED payload";
      }
      break;

    case "SNAPSHOT_RESPONSE":
      if (!validateSnapshotResponseMessage(message)) {
        return "Invalid SNAPSHOT_RESPONSE payload";
      }
      break;

    default:
      return `Unknown message type: ${m.type}`;
  }

  return null;
}
