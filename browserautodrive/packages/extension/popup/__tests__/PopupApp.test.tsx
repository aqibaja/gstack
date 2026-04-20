// PopupApp Component Tests
// Integration tests for the popup UI state machine and component rendering.

import { describe, it, expect, beforeEach, jest, afterEach } from "@jest/globals";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { PopupViewModel, PopupStateMessage, PopupErrorMessage } from "../../shared/messages";

const mockSendMessage = jest.fn<(msg: unknown) => Promise<void>>();
const mockAddListener = jest.fn<(listener: (msg: PopupStateMessage | PopupErrorMessage) => void) => void>();
const mockRemoveListener = jest.fn<(listener: (msg: PopupStateMessage | PopupErrorMessage) => void) => void>();

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

import { PopupApp } from "../PopupApp";

const IDLE_VIEW_MODEL: PopupViewModel = {
  screen: "idle",
  goalDraft: "",
  tier: "free",
  autoExecuteEnabled: false,
  autoExecuteDelayMs: 500,
  run: null,
  step: null,
  error: null,
};

let listener: (msg: PopupStateMessage | PopupErrorMessage) => void;

function renderWithState(overrides: Partial<PopupViewModel> = {}) {
  const state: PopupViewModel = { ...IDLE_VIEW_MODEL, ...overrides };
  mockAddListener.mockImplementation((cb: (msg: PopupStateMessage | PopupErrorMessage) => void) => {
    listener = cb;
  });
  const utils = render(<PopupApp />);
  function deliverState() {
    act(() => { listener({ type: "POPUP_STATE", payload: state }); });
  }
  return { ...utils, deliverState };
}

function queryByText(text: string | RegExp) {
  return screen.queryByText(text);
}

describe("PopupApp — idle screen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
  });

  it("renders goal textarea", () => {
    const { deliverState } = renderWithState();
    deliverState();
    expect(screen.queryByPlaceholderText("Search for flights to NYC")).toBeTruthy();
  });

  it("renders Start button", () => {
    const { deliverState } = renderWithState();
    deliverState();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("Start button is disabled when no goal text", () => {
    const { deliverState } = renderWithState();
    deliverState();
    const btn = screen.getByRole("button", { name: "Start" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("Start button is enabled when goalDraft is set", () => {
    const { deliverState } = renderWithState({ goalDraft: "Book a flight" });
    deliverState();
    const btn = screen.getByRole("button", { name: "Start" });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("dispatches START_GOAL on Start click", () => {
    const { deliverState } = renderWithState({ goalDraft: "Search hotels" });
    deliverState();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(mockSendMessage).toHaveBeenCalledWith({
      type: "START_GOAL",
      payload: { goal: "Search hotels" },
    });
  });

  it("shows Free tier badge", () => {
    const { deliverState } = renderWithState({ tier: "free" });
    deliverState();
    expect(screen.getByText("Free")).toBeTruthy();
  });

  it("shows Pro tier badge", () => {
    const { deliverState } = renderWithState({ tier: "pro" });
    deliverState();
    expect(screen.getByText("Pro")).toBeTruthy();
  });
});

describe("PopupApp — preview screen", () => {
  function makePreviewState(overrides: Partial<PopupViewModel> = {}): PopupViewModel {
    return {
      screen: "preview",
      goalDraft: "",
      tier: "free",
      autoExecuteEnabled: false,
      autoExecuteDelayMs: 500,
      run: { goal: "Book a flight", status: "awaiting_confirm", currentStepIndex: 1, totalSteps: 3 },
      step: {
        stepId: "step-2",
        stepNumber: 2,
        totalSteps: 3,
        selector: "#book-btn",
        action: "click",
        reasoning: "Click the Book button to proceed to payment",
      },
      error: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
  });

  it("renders action label", () => {
    const { deliverState } = renderWithState(makePreviewState());
    deliverState();
    expect(screen.getByText("Click")).toBeTruthy();
  });

  it("renders reasoning text", () => {
    const { deliverState } = renderWithState(makePreviewState());
    deliverState();
    expect(screen.getByText("Click the Book button to proceed to payment")).toBeTruthy();
  });

  it("renders selector", () => {
    const { deliverState } = renderWithState(makePreviewState());
    deliverState();
    expect(screen.getByText("#book-btn")).toBeTruthy();
  });

  it("renders step number", () => {
    const { deliverState } = renderWithState(makePreviewState());
    deliverState();
    expect(screen.getByText("Step 2")).toBeTruthy();
  });

  it("renders total steps", () => {
    const { deliverState } = renderWithState(makePreviewState());
    deliverState();
    expect(screen.getByText("of 3")).toBeTruthy();
  });

  it("renders goal pill", () => {
    const { deliverState } = renderWithState(makePreviewState());
    deliverState();
    expect(screen.getByText("Book a flight")).toBeTruthy();
  });

  it("renders Confirm button", () => {
    const { deliverState } = renderWithState(makePreviewState());
    deliverState();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
  });

  it("renders Skip button", () => {
    const { deliverState } = renderWithState(makePreviewState());
    deliverState();
    expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
  });

  it("auto-execute toggle absent for free tier", () => {
    const { deliverState } = renderWithState(makePreviewState({ tier: "free" }));
    deliverState();
    expect(queryByText(/Auto-execute/)).toBeFalsy();
  });

  it("auto-execute toggle present for pro tier", () => {
    const { deliverState } = renderWithState(makePreviewState({ tier: "pro", autoExecuteEnabled: true }));
    deliverState();
    expect(screen.getByText("Auto-execute after 500ms")).toBeTruthy();
  });

  it("STEP_CONFIRM includes stepId from current step", () => {
    const { deliverState } = renderWithState(makePreviewState());
    deliverState();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const confirmCalls = (mockSendMessage.mock.calls as unknown as [unknown][]).filter(([msg]) => (msg as {type:string}).type === "STEP_CONFIRM");
    expect(confirmCalls.length).toBe(1);
    const msg = confirmCalls[0][0] as { payload: { stepId: string } };
    expect(msg.payload.stepId).toBe("step-2");
  });

  it("STEP_SKIP includes stepId from current step", () => {
    const { deliverState } = renderWithState(makePreviewState());
    deliverState();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const skipCalls = (mockSendMessage.mock.calls as unknown as [unknown][]).filter(([msg]) => (msg as {type:string}).type === "STEP_SKIP");
    expect(skipCalls.length).toBe(1);
    const msg = skipCalls[0][0] as { payload: { stepId: string } };
    expect(msg.payload.stepId).toBe("step-2");
  });
});

describe("PopupApp — executing screen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
  });

  it("shows executing panel", () => {
    const { deliverState } = renderWithState({
      screen: "executing",
      run: { goal: "Search", status: "executing", currentStepIndex: 0, totalSteps: 2 },
      step: { stepId: "s1", stepNumber: 1, totalSteps: 2, selector: "body", action: "navigate", reasoning: "Loading" },
    });
    deliverState();
    expect(screen.getByText("Execution in progress")).toBeTruthy();
  });

  it("Confirm and Skip buttons are disabled during executing", () => {
    const { deliverState } = renderWithState({
      screen: "executing",
      run: { goal: "Search", status: "executing", currentStepIndex: 0, totalSteps: 2 },
      step: { stepId: "s1", stepNumber: 1, totalSteps: 2, selector: "body", action: "navigate", reasoning: "Loading" },
    });
    deliverState();
    const confirmBtn = screen.getByRole("button", { name: "Confirm" });
    const skipBtn = screen.getByRole("button", { name: "Skip" });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
    expect((skipBtn as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("PopupApp — done screen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
  });

  it("shows done panel", () => {
    const { deliverState } = renderWithState({
      screen: "done",
      run: { goal: "Search", status: "done", currentStepIndex: 2, totalSteps: 2 },
      step: null,
    });
    deliverState();
    expect(screen.getByText("Automation complete")).toBeTruthy();
  });

  it("New Goal button dispatches RESET_POPUP", () => {
    const { deliverState } = renderWithState({
      screen: "done",
      run: { goal: "Search", status: "done", currentStepIndex: 2, totalSteps: 2 },
      step: null,
    });
    deliverState();
    fireEvent.click(screen.getByRole("button", { name: "New Goal" }));
    expect(mockSendMessage).toHaveBeenCalledWith({ type: "RESET_POPUP" });
  });
});

describe("PopupApp — error screen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
  });

  it("shows error code", () => {
    const { deliverState } = renderWithState({
      screen: "error",
      run: null,
      step: null,
      error: { code: "element_not_found", message: "Element vanished from the page", recoverable: true },
    });
    deliverState();
    expect(screen.getByText("element_not_found")).toBeTruthy();
  });

  it("shows error message", () => {
    const { deliverState } = renderWithState({
      screen: "error",
      run: null,
      step: null,
      error: { code: "element_not_found", message: "Element vanished from the page", recoverable: true },
    });
    deliverState();
    expect(screen.getByText("Element vanished from the page")).toBeTruthy();
  });

  it("Dismiss button dispatches RESET_POPUP", () => {
    const { deliverState } = renderWithState({
      screen: "error",
      run: null,
      step: null,
      error: { code: "element_not_found", message: "Element vanished", recoverable: true },
    });
    deliverState();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(mockSendMessage).toHaveBeenCalledWith({ type: "RESET_POPUP" });
  });
});

describe("PopupApp — tier auto-execute visibility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
  });

  it("auto-execute absent for free tier", () => {
    const { deliverState } = renderWithState({
      screen: "preview",
      tier: "free",
      run: { goal: "Test", status: "awaiting_confirm", currentStepIndex: 0, totalSteps: 1 },
      step: { stepId: "s1", stepNumber: 1, totalSteps: 1, selector: "body", action: "click", reasoning: "Click" },
    });
    deliverState();
    expect(queryByText(/Auto-execute/)).toBeFalsy();
  });

  it("auto-execute present for pro tier", () => {
    const { deliverState } = renderWithState({
      screen: "preview",
      tier: "pro",
      autoExecuteEnabled: true,
      run: { goal: "Test", status: "awaiting_confirm", currentStepIndex: 0, totalSteps: 1 },
      step: { stepId: "s1", stepNumber: 1, totalSteps: 1, selector: "body", action: "click", reasoning: "Click" },
    });
    deliverState();
    expect(screen.getByText("Auto-execute after 500ms")).toBeTruthy();
  });
});

describe("PopupApp — atomic step replacement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
  });

  it("replaces old step card when new POPUP_STATE arrives", async () => {
    const step1: PopupViewModel = {
      screen: "preview",
      goalDraft: "",
      tier: "free",
      autoExecuteEnabled: false,
      autoExecuteDelayMs: 500,
      run: { goal: "Test", status: "awaiting_confirm", currentStepIndex: 0, totalSteps: 2 },
      step: { stepId: "step-1", stepNumber: 1, totalSteps: 2, selector: "#a", action: "click", reasoning: "First step" },
      error: null,
    };

    let capturedListener: (msg: PopupStateMessage) => void;
    mockAddListener.mockImplementation((cb: (msg: PopupStateMessage) => void) => {
      capturedListener = cb;
    });

    render(<PopupApp />);

    act(() => {
      capturedListener!({ type: "POPUP_STATE", payload: step1 });
    });

    expect(screen.getByText("Step 1")).toBeTruthy();
    expect(screen.getByText("First step")).toBeTruthy();

    const step2: PopupViewModel = {
      ...step1,
      run: { goal: "Test", status: "awaiting_confirm", currentStepIndex: 1, totalSteps: 2 },
      step: { stepId: "step-2", stepNumber: 2, totalSteps: 2, selector: "#b", action: "type", reasoning: "Second step" },
    };

    act(() => {
      capturedListener!({ type: "POPUP_STATE", payload: step2 });
    });

    expect(screen.getByText("Step 2")).toBeTruthy();
    expect(screen.getByText("Second step")).toBeTruthy();
    expect(screen.queryByText("Step 1")).toBeFalsy();
    expect(screen.queryByText("First step")).toBeFalsy();
  });
});
