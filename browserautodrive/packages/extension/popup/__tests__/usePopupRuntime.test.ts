// Popup Runtime Hook Tests
// Unit tests for usePopupRuntime: message mapping, action dispatch, and pending state.

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import type { PopupViewModel, PopupStateMessage, PopupErrorMessage } from "../../shared/messages";

const mockSendMessage = jest.fn<() => Promise<void>>();
const mockAddListener = jest.fn<(listener: (msg: PopupStateMessage | PopupErrorMessage) => void) => void>();
const mockRemoveListener = jest.fn<(listener: (msg: PopupStateMessage | PopupErrorMessage) => void) => void>();

// Declare chrome as any to bypass type checking in the test environment.
// In the actual Chrome extension runtime, chrome is provided by the browser.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).chrome = {
  runtime: {
    id: "test-extension-id",
    sendMessage: mockSendMessage,
    onMessage: {
      addListener: mockAddListener,
      removeListener: mockRemoveListener,
    },
  },
};

import { usePopupRuntime } from "../hooks/usePopupRuntime";
import { renderHook, act } from "@testing-library/react";

const defaultViewModel: PopupViewModel = {
  screen: "idle",
  goalDraft: "",
  tier: "free",
  autoExecuteEnabled: false,
  autoExecuteDelayMs: 500,
  run: null,
  step: null,
  error: null,
};

function makePopupState(overrides: Partial<PopupViewModel>): PopupStateMessage {
  return {
    type: "POPUP_STATE",
    payload: { ...defaultViewModel, ...overrides },
  };
}

function makePopupError(code = "test_error", message = "Test error", recoverable = true): PopupErrorMessage {
  return {
    type: "POPUP_ERROR",
    payload: { code, message, recoverable },
  };
}

describe("usePopupRuntime", () => {
  let listener: (msg: PopupStateMessage | PopupErrorMessage) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
    mockAddListener.mockImplementation((cb: (msg: PopupStateMessage | PopupErrorMessage) => void) => {
      listener = cb;
    });
  });

  afterEach(() => {
    if (listener) {
      mockRemoveListener.mock.calls.forEach(([cb]) => cb({ type: "POPUP_STATE", payload: defaultViewModel }));
    }
  });

  describe("mount lifecycle", () => {
    it("sends POPUP_READY on mount", () => {
      const { result } = renderHook(() => usePopupRuntime());
      void result.current;
      expect(mockSendMessage).toHaveBeenCalledWith({ type: "POPUP_READY" });
    });

    it("registers a message listener on mount", () => {
      renderHook(() => usePopupRuntime());
      expect(mockAddListener).toHaveBeenCalled();
    });

    it("removes listener on unmount", () => {
      const { unmount } = renderHook(() => usePopupRuntime());
      unmount();
      expect(mockRemoveListener).toHaveBeenCalled();
    });
  });

  describe("POPUP_STATE mapping", () => {
    it("maps POPUP_STATE to viewModel", () => {
      const { result } = renderHook(() => usePopupRuntime());
      const step = {
        stepId: "step-1",
        stepNumber: 2,
        totalSteps: 5,
        selector: "#submit-btn",
        action: "click",
        reasoning: "Click the submit button to proceed",
      };
      const stateMsg = makePopupState({
        screen: "preview",
        run: { goal: "Book a flight", status: "awaiting_confirm", currentStepIndex: 1, totalSteps: 5 },
        step,
      });

      act(() => { listener(stateMsg); });

      expect(result.current.viewModel.screen).toBe("preview");
      expect(result.current.viewModel.run?.goal).toBe("Book a flight");
      expect(result.current.viewModel.step?.stepId).toBe("step-1");
      expect(result.current.viewModel.step?.action).toBe("click");
    });

    it("maps POPUP_STATE with executing screen", () => {
      const { result } = renderHook(() => usePopupRuntime());
      act(() => {
        listener(makePopupState({
          screen: "executing",
          run: { goal: "Search hotels", status: "executing", currentStepIndex: 0, totalSteps: 3 },
        }));
      });
      expect(result.current.viewModel.screen).toBe("executing");
    });

    it("maps POPUP_STATE with done screen", () => {
      const { result } = renderHook(() => usePopupRuntime());
      act(() => {
        listener(makePopupState({
          screen: "done",
          run: { goal: "Find restaurants", status: "done", currentStepIndex: 2, totalSteps: 3 },
        }));
      });
      expect(result.current.viewModel.screen).toBe("done");
    });

    it("maps tier correctly for free tier", () => {
      const { result } = renderHook(() => usePopupRuntime());
      act(() => { listener(makePopupState({ tier: "free", autoExecuteEnabled: false })); });
      expect(result.current.viewModel.tier).toBe("free");
      expect(result.current.viewModel.autoExecuteEnabled).toBe(false);
    });

    it("maps tier correctly for pro tier", () => {
      const { result } = renderHook(() => usePopupRuntime());
      act(() => { listener(makePopupState({ tier: "pro", autoExecuteEnabled: true })); });
      expect(result.current.viewModel.tier).toBe("pro");
      expect(result.current.viewModel.autoExecuteEnabled).toBe(true);
    });
  });

  describe("POPUP_ERROR mapping", () => {
    it("sets screen to error on POPUP_ERROR", () => {
      const { result } = renderHook(() => usePopupRuntime());
      act(() => {
        listener(makePopupError("element_not_found", "Element vanished from page", true));
      });
      expect(result.current.viewModel.screen).toBe("error");
      expect(result.current.viewModel.error?.code).toBe("element_not_found");
      expect(result.current.viewModel.error?.message).toBe("Element vanished from page");
      expect(result.current.viewModel.error?.recoverable).toBe(true);
    });

    it("clears pendingAction on POPUP_ERROR", () => {
      const { result } = renderHook(() => usePopupRuntime());
      act(() => { listener(makePopupError()); });
      expect(result.current.pendingAction).toBeNull();
    });
  });

  describe("action dispatching", () => {
    it("startGoal sends START_GOAL with goal string", async () => {
      const { result } = renderHook(() => usePopupRuntime());
      await act(async () => {
        await result.current.startGoal("Search for flights to NYC");
      });
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: "START_GOAL",
        payload: { goal: "Search for flights to NYC" },
      });
    });

    it("confirmStep sends STEP_CONFIRM with stepId", async () => {
      const { result } = renderHook(() => usePopupRuntime());
      await act(async () => {
        await result.current.confirmStep("step-42");
      });
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: "STEP_CONFIRM",
        payload: { stepId: "step-42" },
      });
    });

    it("skipStep sends STEP_SKIP with stepId", async () => {
      const { result } = renderHook(() => usePopupRuntime());
      await act(async () => {
        await result.current.skipStep("step-99");
      });
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: "STEP_SKIP",
        payload: { stepId: "step-99" },
      });
    });

    it("markUserIntervened sends USER_INTERVENED without setting pendingAction", async () => {
      jest.useFakeTimers();
      const { result } = renderHook(() => usePopupRuntime());
      await act(async () => {
        await result.current.markUserIntervened("step-7");
      });
      act(() => { jest.runAllTimers(); });
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: "USER_INTERVENED",
        payload: { stepId: "step-7" },
      });
      expect(result.current.pendingAction).toBeNull();
      jest.useRealTimers();
    });

    it("toggleAutoExecute sends SET_AUTO_EXECUTE", async () => {
      const { result } = renderHook(() => usePopupRuntime());
      await act(async () => {
        await result.current.toggleAutoExecute(true);
      });
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: "SET_AUTO_EXECUTE",
        payload: { enabled: true },
      });
    });

    it("resetPopup sends RESET_POPUP", async () => {
      const { result } = renderHook(() => usePopupRuntime());
      await act(async () => {
        await result.current.resetPopup();
      });
      expect(mockSendMessage).toHaveBeenCalledWith({ type: "RESET_POPUP" });
    });
  });

  describe("pendingAction state", () => {
    it("pendingAction is null by default (idle state)", () => {
      const { result } = renderHook(() => usePopupRuntime());
      expect(result.current.pendingAction).toBeNull();
    });

    it("pendingAction is null after POPUP_STATE update", () => {
      const { result } = renderHook(() => usePopupRuntime());
      act(() => {
        listener(makePopupState({ screen: "preview" }));
      });
      expect(result.current.pendingAction).toBeNull();
    });
  });
});
