// BrowserAutoDrive — Message Handler Registry
// Defines all message handlers for the service worker.

import { messageRouter, type MessageRoute } from "./message-router";
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
  StartGoalMessage,
} from "../shared/messages";

// ─── State ───────────────────────────────────────────────────────────────────

interface StepDefinition {
  stepId: string;
  stepNumber: number;
  totalSteps: number;
  selector: string;
  action: string;
  value?: string;
  reasoning: string;
}

interface PreviewState {
  goal: string;
  steps: StepDefinition[];
  currentStepIndex: number;
  tabId: number;
  tier: "free" | "pro";
  autoExecute: boolean;
  status: "idle" | "previewing" | "awaiting_confirm" | "executing" | "done";
}

let previewState: PreviewState | null = null;
let autoExecuteTimeout: ReturnType<typeof setTimeout> | null = null;
let userIntervenedForStep: string | null = null;

const AUTO_EXECUTE_DELAY_MS = 500;

// ─── Tier Config ─────────────────────────────────────────────────────────────

function getTierConfig(): Promise<{ tier: "free" | "pro"; autoExecute: boolean }> {
  return new Promise((resolve) => {
    chrome.storage.local.get(["tier", "autoExecute"], (result) => {
      resolve({
        tier: result.tier === "pro" ? "pro" : "free",
        autoExecute: result.autoExecute === true,
      });
    });
  });
}

// ─── Tab Helpers ─────────────────────────────────────────────────────────────

function getActiveTabId(): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id != null) {
        resolve(tabs[0].id);
      } else {
        reject(new Error("No active tab found"));
      }
    });
  });
}

// ─── Preview Flow ────────────────────────────────────────────────────────────

async function startPreview(step: StepDefinition, tabId: number): Promise<void> {
  if (!previewState) return;

  previewState.status = "previewing";
  userIntervenedForStep = null;
  cancelAutoExecute();

  const tierConfig = await getTierConfig();

  // Send PREVIEW_STEP to content script
  await messageRouter.sendMessageToTab(tabId, {
    type: "PREVIEW_STEP",
    payload: {
      stepId: step.stepId,
      stepNumber: step.stepNumber,
      totalSteps: step.totalSteps,
      selector: step.selector,
      action: step.action,
      value: step.value,
      reasoning: step.reasoning,
      tier: tierConfig.tier,
    },
  });

  // Also send to popup so it can render the step card
  await messageRouter.sendMessageToPopup({
    type: "PREVIEW_STEP",
    payload: {
      stepId: step.stepId,
      stepNumber: step.stepNumber,
      totalSteps: step.totalSteps,
      selector: step.selector,
      action: step.action,
      value: step.value,
      reasoning: step.reasoning,
    },
  });
}

async function advanceToNextStep(): Promise<void> {
  if (!previewState) return;

  previewState.currentStepIndex++;
  cancelAutoExecute();

  if (previewState.currentStepIndex >= previewState.steps.length) {
    // All steps complete
    previewState.status = "done";
    await messageRouter.sendMessageToTab(previewState.tabId, { type: "CLEAR_PREVIEW" });
    await messageRouter.sendMessageToPopup({ type: "CLEAR_PREVIEW", payload: { done: true } });
    return;
  }

  const nextStep = previewState.steps[previewState.currentStepIndex];
  await startPreview(nextStep, previewState.tabId);
}

async function skipCurrentStep(): Promise<void> {
  await advanceToNextStep();
}

async function confirmCurrentStep(): Promise<void> {
  if (!previewState) return;

  previewState.status = "executing";

  // Clear overlay before executing
  await messageRouter.sendMessageToTab(previewState.tabId, { type: "CLEAR_PREVIEW" });

  // Execute the actual action on the tab
  // (In a full implementation, this would call the content script action executor)
  // For now, advance to next step
  await advanceToNextStep();
}

// ─── Auto-Execute (Pro) ──────────────────────────────────────────────────────

function startAutoExecuteTimeout(stepId: string): void {
  cancelAutoExecute();

  if (!previewState) return;
  if (previewState.tier !== "pro" || !previewState.autoExecute) return;
  if (userIntervenedForStep === stepId) return;

  autoExecuteTimeout = setTimeout(async () => {
    if (userIntervenedForStep === stepId) return;
    if (!previewState) return;
    await confirmCurrentStep();
  }, AUTO_EXECUTE_DELAY_MS);
}

function cancelAutoExecute(): void {
  if (autoExecuteTimeout !== null) {
    clearTimeout(autoExecuteTimeout);
    autoExecuteTimeout = null;
  }
}

// ─── Message Handlers ────────────────────────────────────────────────────────

function handleElementSnapshot(message: ElementSnapshotMessage): void {
  const { stepId, snapshot } = message.payload;

  // If snapshot is null, element not found — skip this step
  if (snapshot === null) {
    console.warn("[BAD] Element not found for step", stepId);
    skipCurrentStep().catch((err) => console.error("[BAD] Error skipping step:", err));
  } else {
    // Element found — start auto-execute timer if pro
    if (previewState) {
      previewState.status = "awaiting_confirm";
      startAutoExecuteTimeout(stepId);
    }
  }
}

function handleStepConfirm(message: StepConfirmMessage): void {
  if (previewState?.status === "awaiting_confirm" || previewState?.status === "previewing") {
    confirmCurrentStep().catch((err) => console.error("[BAD] Error confirming step:", err));
  }
}

function handleStepSkip(message: StepSkipMessage): void {
  if (previewState?.status === "awaiting_confirm" || previewState?.status === "previewing") {
    skipCurrentStep().catch((err) => console.error("[BAD] Error skipping step:", err));
  }
}

function handleStepSkippedAll(message: StepSkippedAllMessage): void {
  // Skip all remaining steps
  if (previewState) {
    previewState.currentStepIndex = previewState.steps.length - 1;
    advanceToNextStep().catch((err) => console.error("[BAD] Error advancing:", err));
  }
}

function handleAutoExecuteTimeout(message: AutoExecuteTimeoutMessage): void {
  // Handle auto-execute timeout
  if (previewState?.status === "awaiting_confirm") {
    confirmCurrentStep().catch((err) => console.error("[BAD] Error auto-executing:", err));
  }
}

function handleUserIntervened(message: UserIntervenedMessage): void {
  userIntervenedForStep = message.payload.stepId;
  cancelAutoExecute();
}

function handleTierConfig(message: TierConfigMessage): void {
  // Update tier configuration
  chrome.storage.local.set({
    tier: message.payload.tier,
    autoExecute: message.payload.autoExecute,
  });
}

async function handleStartGoal(message: StartGoalMessage): Promise<void> {
  const tierConfig = await getTierConfig();
  const tabId = await getActiveTabId();

  // In a full implementation, this would use the agent loop to generate steps
  // For now, create a placeholder single step
  previewState = {
    goal: message.payload.goal,
    steps: [
      {
        stepId: crypto.randomUUID(),
        stepNumber: 1,
        totalSteps: 1,
        selector: "body",
        action: "click",
        reasoning: "Executing goal: " + message.payload.goal,
      },
    ],
    currentStepIndex: 0,
    tabId,
    tier: tierConfig.tier,
    autoExecute: tierConfig.autoExecute,
    status: "idle",
  };

  await startPreview(previewState.steps[0], tabId);
}

// ─── Route Registration ──────────────────────────────────────────────────────

export function registerMessageHandlers(): void {
  const routes: MessageRoute[] = [
    {
      type: "ELEMENT_SNAPSHOT",
      handler: (message) => {
        handleElementSnapshot(message as ElementSnapshotMessage);
        return false;
      },
      description: "Handle element snapshot from content script",
    },
    {
      type: "STEP_CONFIRM",
      handler: (message) => {
        handleStepConfirm(message as StepConfirmMessage);
        return false;
      },
      description: "Handle step confirmation from popup",
    },
    {
      type: "STEP_SKIP",
      handler: (message) => {
        handleStepSkip(message as StepSkipMessage);
        return false;
      },
      description: "Handle step skip from popup",
    },
    {
      type: "STEP_SKIP_ALL",
      handler: (message) => {
        handleStepSkippedAll(message as StepSkippedAllMessage);
        return false;
      },
      description: "Handle skip all steps from popup",
    },
    {
      type: "AUTO_EXECUTE_TIMEOUT",
      handler: (message) => {
        handleAutoExecuteTimeout(message as AutoExecuteTimeoutMessage);
        return false;
      },
      description: "Handle auto-execute timeout",
    },
    {
      type: "USER_INTERVENED",
      handler: (message) => {
        handleUserIntervened(message as UserIntervenedMessage);
        return false;
      },
      description: "Handle user intervention from popup",
    },
    {
      type: "TIER_CONFIG",
      handler: (message) => {
        handleTierConfig(message as TierConfigMessage);
        return false;
      },
      description: "Handle tier configuration update",
    },
    {
      type: "START_GOAL",
      handler: (message) => {
        handleStartGoal(message as StartGoalMessage);
        return false;
      },
      description: "Handle goal start from popup",
    },
  ];

  messageRouter.registerRoutes(routes);
  console.log("[BAD] Registered", routes.length, "message handlers");
}

// ─── State Management ────────────────────────────────────────────────────────

export function getPreviewState(): PreviewState | null {
  return previewState;
}

export function resetPreviewState(): void {
  cancelAutoExecute();
  previewState = null;
  userIntervenedForStep = null;
}
