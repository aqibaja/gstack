import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ExtensionMessage,
  PopupErrorMessage,
  PopupStateMessage,
  PopupViewModel,
} from "../../shared/messages";
import { defaultPopupViewModel } from "../state/popup-view-model";

async function sendRuntimeMessage(message: ExtensionMessage): Promise<void> {
  await chrome.runtime.sendMessage(message);
}

export function usePopupRuntime() {
  const [viewModel, setViewModel] = useState<PopupViewModel>(defaultPopupViewModel);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const listener = useCallback((message: PopupStateMessage | PopupErrorMessage) => {
    if (message.type === "POPUP_STATE") {
      setViewModel(message.payload);
      setPendingAction(null);
    }

    if (message.type === "POPUP_ERROR") {
      setViewModel((current) => ({
        ...current,
        screen: "error",
        error: message.payload,
      }));
      setPendingAction(null);
    }
  }, []);

  useEffect(() => {
    chrome.runtime.onMessage.addListener(listener);
    void sendRuntimeMessage({ type: "POPUP_READY" });

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [listener]);

  const performAction = async (action: string, message: ExtensionMessage) => {
    setPendingAction(action);
    try {
      await sendRuntimeMessage(message);
    } catch (error) {
      setPendingAction(null);
      throw error;
    }
  };

  const lastIntervenedStepRef = useRef<string | null>(null);
  const interveneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markUserIntervened = useCallback((stepId: string) => {
    if (lastIntervenedStepRef.current === stepId) return;
    lastIntervenedStepRef.current = stepId;

    if (interveneTimerRef.current !== null) {
      clearTimeout(interveneTimerRef.current);
    }
    interveneTimerRef.current = setTimeout(() => {
      interveneTimerRef.current = null;
      lastIntervenedStepRef.current = null;
      void sendRuntimeMessage({ type: "USER_INTERVENED", payload: { stepId } });
    }, 1000);
  }, []);

  return {
    viewModel,
    pendingAction,
    startGoal: (goal: string) => performAction("start-goal", { type: "START_GOAL", payload: { goal } }),
    confirmStep: (stepId: string) => performAction("confirm-step", { type: "STEP_CONFIRM", payload: { stepId } }),
    skipStep: (stepId: string) => performAction("skip-step", { type: "STEP_SKIP", payload: { stepId } }),
    markUserIntervened,
    toggleAutoExecute: (enabled: boolean) =>
      performAction("toggle-auto-execute", { type: "SET_AUTO_EXECUTE", payload: { enabled } }),
    resetPopup: () => performAction("reset-popup", { type: "RESET_POPUP" }),
  };
}
