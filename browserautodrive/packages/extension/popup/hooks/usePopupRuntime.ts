import { useEffect, useState } from "react";
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

  useEffect(() => {
    const listener = (message: PopupStateMessage | PopupErrorMessage) => {
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
    };

    chrome.runtime.onMessage.addListener(listener);
    void sendRuntimeMessage({ type: "POPUP_READY" });

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  const performAction = async (action: string, message: ExtensionMessage) => {
    setPendingAction(action);
    try {
      await sendRuntimeMessage(message);
    } catch (error) {
      setPendingAction(null);
      throw error;
    }
  };

  return {
    viewModel,
    pendingAction,
    startGoal: (goal: string) => performAction("start-goal", { type: "START_GOAL", payload: { goal } }),
    confirmStep: (stepId: string) => performAction("confirm-step", { type: "STEP_CONFIRM", payload: { stepId } }),
    skipStep: (stepId: string) => performAction("skip-step", { type: "STEP_SKIP", payload: { stepId } }),
    markUserIntervened: (stepId: string) => sendRuntimeMessage({ type: "USER_INTERVENED", payload: { stepId } }),
    toggleAutoExecute: (enabled: boolean) =>
      performAction("toggle-auto-execute", { type: "SET_AUTO_EXECUTE", payload: { enabled } }),
    resetPopup: () => performAction("reset-popup", { type: "RESET_POPUP" }),
  };
}
