import type {
  ActionResultMessage,
  ActionType,
  ExtensionMessage,
  PopupErrorMessage,
  PopupErrorState,
  PopupStateMessage,
  PopupStepState,
  PopupViewModel,
  RunStatus,
  TierType,
} from "../shared/messages";
import { startAgentLoop, stopAgentLoop, getAgentLoopState, restoreAgentLoop } from "./agent-loop";

interface ActiveRunState {
  goal: string;
  steps: PopupStepState[];
  currentStepIndex: number;
  tabId: number;
  status: RunStatus;
}

interface WorkerRuntimeState {
  goalDraft: string;
  tier: TierType;
  autoExecuteEnabled: boolean;
  error: PopupErrorState | null;
  activeRun: ActiveRunState | null;
}

const AUTO_EXECUTE_DELAY_MS = 500;
const POPUP_RUNTIME_STORAGE_KEY = "bad.popupRuntimeState";

let runtimeState: WorkerRuntimeState | null = null;
let autoExecuteTimeout: ReturnType<typeof setTimeout> | null = null;
let userIntervenedForStep: string | null = null;

function getRuntimeStorageArea(): chrome.storage.StorageArea {
  return chrome.storage.session ?? chrome.storage.local;
}

function storageGet<T>(area: chrome.storage.StorageArea, keys: string[]): Promise<Record<string, T | undefined>> {
  return new Promise((resolve) => {
    area.get(keys, (result) => resolve(result as Record<string, T | undefined>));
  });
}

function storageSet(area: chrome.storage.StorageArea, value: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    area.set(value, () => resolve());
  });
}

async function getTierConfig(): Promise<{ tier: TierType; autoExecute: boolean }> {
  return new Promise((resolve) => {
    chrome.storage.local.get(["tier", "autoExecute"], (result) => {
      resolve({
        tier: result.tier === "pro" ? "pro" : "free",
        autoExecute: result.tier === "pro" && result.autoExecute === true,
      });
    });
  });
}

function createDefaultRuntimeState(tier: TierType, autoExecuteEnabled: boolean): WorkerRuntimeState {
  return {
    goalDraft: "",
    tier,
    autoExecuteEnabled,
    error: null,
    activeRun: null,
  };
}

async function persistRuntimeState(): Promise<void> {
  if (!runtimeState) return;
  await storageSet(getRuntimeStorageArea(), { [POPUP_RUNTIME_STORAGE_KEY]: runtimeState });
}

async function ensureRuntimeState(): Promise<WorkerRuntimeState> {
  const tierConfig = await getTierConfig();

  if (runtimeState) {
    runtimeState.tier = tierConfig.tier;
    runtimeState.autoExecuteEnabled = tierConfig.autoExecute;
    return runtimeState;
  }

  const storageArea = getRuntimeStorageArea();
  const stored = await storageGet<WorkerRuntimeState>(storageArea, [POPUP_RUNTIME_STORAGE_KEY]);
  const restored = stored[POPUP_RUNTIME_STORAGE_KEY];

  runtimeState = restored
    ? {
        ...restored,
        tier: tierConfig.tier,
        autoExecuteEnabled: tierConfig.autoExecute,
      }
    : createDefaultRuntimeState(tierConfig.tier, tierConfig.autoExecute);

  return runtimeState;
}

function getCurrentStep(state: WorkerRuntimeState | null): PopupStepState | null {
  if (!state?.activeRun) return null;
  return state.activeRun.steps[state.activeRun.currentStepIndex] ?? null;
}

function getPopupScreen(state: WorkerRuntimeState): PopupViewModel["screen"] {
  if (state.error) return "error";

  const status = state.activeRun?.status;
  if (!status || status === "idle") return "idle";
  if (status === "previewing" || status === "awaiting_confirm") return "preview";
  if (status === "executing") return "executing";
  if (status === "done") return "done";
  return "error";
}

function toPopupViewModel(state: WorkerRuntimeState): PopupViewModel {
  const currentStep = getCurrentStep(state);

  return {
    screen: getPopupScreen(state),
    goalDraft: state.goalDraft,
    tier: state.tier,
    autoExecuteEnabled: state.autoExecuteEnabled,
    autoExecuteDelayMs: AUTO_EXECUTE_DELAY_MS,
    run: state.activeRun
      ? {
          goal: state.activeRun.goal,
          status: state.activeRun.status,
          currentStepIndex: state.activeRun.currentStepIndex,
          totalSteps: state.activeRun.steps.length,
        }
      : null,
    step: currentStep,
    error: state.error,
  };
}

async function sendToTab(tabId: number, message: ExtensionMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.warn("[BAD] Failed to send message to tab", tabId, error);
  }
}

async function sendToPopup(message: PopupStateMessage | PopupErrorMessage): Promise<void> {
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    // Popup may be closed; popup state is still persisted.
  }
}

async function publishPopupState(): Promise<void> {
  const state = await ensureRuntimeState();
  await persistRuntimeState();
  await sendToPopup({
    type: "POPUP_STATE",
    payload: toPopupViewModel(state),
  });
}

async function setRuntimeError(error: PopupErrorState | null): Promise<void> {
  const state = await ensureRuntimeState();
  state.error = error;
  await persistRuntimeState();

  if (error) {
    await sendToPopup({
      type: "POPUP_ERROR",
      payload: error,
    });
  }

  await publishPopupState();
}

function cancelAutoExecute(): void {
  if (autoExecuteTimeout) {
    clearTimeout(autoExecuteTimeout);
    autoExecuteTimeout = null;
  }
}

function isCurrentStep(stepId: string): boolean {
  return getCurrentStep(runtimeState)?.stepId === stepId;
}

async function getActiveTabId(): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id != null) {
        resolve(tabs[0].id);
        return;
      }

      reject(new Error("No active tab found"));
    });
  });
}

async function startPreview(step: PopupStepState): Promise<void> {
  const state = await ensureRuntimeState();
  if (!state.activeRun) return;

  state.activeRun.status = "previewing";
  state.error = null;
  userIntervenedForStep = null;
  cancelAutoExecute();

  await publishPopupState();
  await sendToTab(state.activeRun.tabId, {
    type: "PREVIEW_STEP",
    payload: {
      ...step,
      tier: state.tier,
    },
  });
}

async function completeRun(done: boolean): Promise<void> {
  const state = await ensureRuntimeState();
  if (!state.activeRun) return;

  cancelAutoExecute();
  state.error = null;
  state.activeRun.status = done ? "done" : "idle";

  await sendToTab(state.activeRun.tabId, {
    type: "CLEAR_PREVIEW",
    payload: done ? { done: true } : undefined,
  });
  await publishPopupState();
}

async function advanceToNextStep(): Promise<void> {
  const state = await ensureRuntimeState();
  if (!state.activeRun) return;

  state.activeRun.currentStepIndex += 1;
  state.error = null;
  cancelAutoExecute();

  if (state.activeRun.currentStepIndex >= state.activeRun.steps.length) {
    await completeRun(true);
    return;
  }

  const nextStep = getCurrentStep(state);
  if (!nextStep) {
    await setRuntimeError({
      code: "missing_step",
      message: "The popup state could not find the next step to preview.",
      recoverable: false,
    });
    return;
  }

  await startPreview(nextStep);
}

async function confirmCurrentStep(): Promise<void> {
  const state = await ensureRuntimeState();
  if (!state.activeRun) return;

  state.activeRun.status = "executing";
  await publishPopupState();

  await sendToTab(state.activeRun.tabId, { type: "CLEAR_PREVIEW" });

  const step = getCurrentStep(state);
  if (!step) {
    await setRuntimeError({
      code: "missing_step",
      message: "No step found to execute.",
      recoverable: false,
    });
    return;
  }

  try {
    await chrome.tabs.sendMessage(state.activeRun.tabId, {
      type: "EXECUTE_ACTION",
      payload: {
        stepId: step.stepId,
        selector: step.selector,
        action: step.action as ActionType,
        value: step.value,
      },
    });
  } catch (error) {
    await setRuntimeError({
      code: "content_script_unavailable",
      message: "Could not reach the content script. Reload the page and try again.",
      recoverable: true,
    });
    state.activeRun.status = "awaiting_confirm";
    await publishPopupState();
  }
}

async function handleActionResult(result: ActionResultMessage["payload"]): Promise<void> {
  const state = await ensureRuntimeState();
  if (!state.activeRun) return;
  if (!isCurrentStep(result.stepId)) return;

  if (result.status === "success") {
    await advanceToNextStep();
  } else {
    await setRuntimeError({
      code: result.errorCode || "action_failed",
      message: result.errorMessage || "Action execution failed.",
      recoverable: true,
    });
    state.activeRun.status = "awaiting_confirm";
    await publishPopupState();
  }
}

async function skipCurrentStep(): Promise<void> {
  await advanceToNextStep();
}

function startAutoExecuteTimeout(stepId: string): void {
  cancelAutoExecute();

  if (!runtimeState?.activeRun) return;
  if (runtimeState.tier !== "pro" || !runtimeState.autoExecuteEnabled) return;
  if (userIntervenedForStep === stepId) return;

  autoExecuteTimeout = setTimeout(() => {
    if (!runtimeState?.activeRun) return;
    if (userIntervenedForStep === stepId) return;
    if (!isCurrentStep(stepId)) return;

    void confirmCurrentStep();
  }, AUTO_EXECUTE_DELAY_MS);
}

async function resetPopupState(): Promise<void> {
  const state = await ensureRuntimeState();
  const tabId = state.activeRun?.tabId;

  cancelAutoExecute();
  state.goalDraft = "";
  state.error = null;
  state.activeRun = null;
  userIntervenedForStep = null;

  if (tabId != null) {
    await sendToTab(tabId, { type: "CLEAR_PREVIEW" });
  }

  await publishPopupState();
}

async function setAutoExecute(enabled: boolean): Promise<void> {
  const state = await ensureRuntimeState();
  const nextValue = state.tier === "pro" && enabled;

  await storageSet(chrome.storage.local, { autoExecute: nextValue });
  state.autoExecuteEnabled = nextValue;

  if (!nextValue) {
    cancelAutoExecute();
  } else {
    const currentStep = getCurrentStep(state);
    if (currentStep && state.activeRun?.status === "awaiting_confirm") {
      startAutoExecuteTimeout(currentStep.stepId);
    }
  }

  await publishPopupState();
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender) => {
  if (sender.id !== chrome.runtime.id) return false;

  const handler = async () => {
    const state = await ensureRuntimeState();

    switch (message.type) {
      case "POPUP_READY": {
        await publishPopupState();
        break;
      }

      case "START_GOAL": {
        const goal = message.payload.goal.trim();
        if (!goal) {
          await publishPopupState();
          return;
        }

        try {
          const tabId = await getActiveTabId();
          const { sessionId } = await startAgentLoop(goal, tabId);

          state.goalDraft = goal;
          state.error = null;
          state.activeRun = {
            goal,
            steps: [{
              stepId: sessionId,
              stepNumber: 1,
              totalSteps: 1,
              selector: "body",
              action: "click",
              reasoning: `Executing goal: ${goal}`,
            }],
            currentStepIndex: 0,
            tabId,
            status: "executing",
          };

          await publishPopupState();
        } catch (error) {
          await setRuntimeError({
            code: "agent_loop_failed",
            message: error instanceof Error ? error.message : "Failed to start agent loop.",
            recoverable: true,
          });
        }
        break;
      }

      case "ELEMENT_SNAPSHOT": {
        if (!isCurrentStep(message.payload.stepId)) {
          await publishPopupState();
          return;
        }

        if (message.payload.snapshot === null) {
          await setRuntimeError({
            code: "element_not_found",
            message: "The highlighted element could not be found on the page anymore.",
            recoverable: true,
          });
          await skipCurrentStep();
          return;
        }

        if (state.activeRun) {
          state.activeRun.status = "awaiting_confirm";
          state.error = null;
          startAutoExecuteTimeout(message.payload.stepId);
        }

        await publishPopupState();
        break;
      }

      case "STEP_CONFIRM": {
        if (!isCurrentStep(message.payload.stepId)) {
          await publishPopupState();
          return;
        }

        if (state.activeRun?.status === "awaiting_confirm" || state.activeRun?.status === "previewing") {
          await confirmCurrentStep();
        } else {
          await publishPopupState();
        }
        break;
      }

      case "STEP_SKIP": {
        if (!isCurrentStep(message.payload.stepId)) {
          await publishPopupState();
          return;
        }

        if (state.activeRun?.status === "awaiting_confirm" || state.activeRun?.status === "previewing") {
          await skipCurrentStep();
        } else {
          await publishPopupState();
        }
        break;
      }

      case "USER_INTERVENED": {
        if (isCurrentStep(message.payload.stepId)) {
          userIntervenedForStep = message.payload.stepId;
          cancelAutoExecute();
        }
        break;
      }

      case "SET_AUTO_EXECUTE": {
        await setAutoExecute(message.payload.enabled);
        break;
      }

      case "RESET_POPUP": {
        await resetPopupState();
        break;
      }

      case "PAGE_MUTATED": {
        console.log("[BAD] Page mutated:", message.payload.url, "at", message.payload.timestamp);
        break;
      }

      case "SNAPSHOT_RESPONSE": {
        console.log(
          "[BAD] Snapshot received:",
          message.payload.url,
          message.payload.interactiveElements.length,
          "interactive elements"
        );
        break;
      }

      case "ACTION_RESULT": {
        await handleActionResult(message.payload);
        break;
      }

      default:
        break;
    }
  };

  void handler().catch((error) => {
    console.error("[BAD] Message handler error:", error);
  });

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["tier"], async (result) => {
    if (!result.tier) {
      chrome.storage.local.set({ tier: "free", autoExecute: false });
    }

    runtimeState = createDefaultRuntimeState(result.tier === "pro" ? "pro" : "free", false);
    await persistRuntimeState();
  });
});
