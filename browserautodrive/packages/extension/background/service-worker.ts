// BrowserAutoDrive — Background Service Worker
// Orchestrates preview flow between popup and content scripts.
// Manages step execution, auto-execute (Pro), and tier enforcement.

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── State ───────────────────────────────────────────────────────────────────

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

async function sendToTab(tabId: number, message: unknown): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    // Content script may not be injected yet — silently ignore
    console.warn("[BAD] Failed to send message to tab", tabId, err);
  }
}

async function sendToPopup(message: unknown): Promise<void> {
  try {
    // Use chrome.runtime.getContexts (MV3) to find popup views
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["POPUP" as chrome.runtime.ContextType],
    });
    // If no popup is open, this is a no-op
    // We communicate via chrome.runtime.sendMessage which delivers to all extension views
    if (contexts.length > 0) {
      chrome.runtime.sendMessage(message).catch(() => {
        // Popup may have closed between getContexts and sendMessage
      });
    }
  } catch {
    // getContexts may not be available in all Chrome versions — fallback to sendMessage
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      // No listeners — expected if popup is closed
    }
  }
}

// ─── Preview Flow ────────────────────────────────────────────────────────────

async function startPreview(step: StepDefinition, tabId: number): Promise<void> {
  if (!previewState) return;

  previewState.status = "previewing";
  userIntervenedForStep = null;
  cancelAutoExecute();

  const tierConfig = await getTierConfig();

  // Send PREVIEW_STEP to content script
  await sendToTab(tabId, {
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
  await sendToPopup({
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
    await sendToTab(previewState.tabId, { type: "CLEAR_PREVIEW" });
    await sendToPopup({ type: "CLEAR_PREVIEW", payload: { done: true } });
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
  await sendToTab(previewState.tabId, { type: "CLEAR_PREVIEW" });

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only accept messages from our own extension — reject page-injected messages
  if (sender.id !== chrome.runtime.id) return false;

  const handler = async () => {
    switch (message.type) {
      case "ELEMENT_SNAPSHOT": {
        // Content script returned element snapshot
        // If snapshot is null, element not found — skip this step
        if (message.payload.snapshot === null) {
          console.warn("[BAD] Element not found for step", message.payload.stepId);
          await skipCurrentStep();
        } else {
          // Element found — start auto-execute timer if pro
          if (previewState) {
            previewState.status = "awaiting_confirm";
            startAutoExecuteTimeout(message.payload.stepId);
          }
        }
        break;
      }

      case "STEP_CONFIRM": {
        if (previewState?.status === "awaiting_confirm" || previewState?.status === "previewing") {
          await confirmCurrentStep();
        }
        break;
      }

      case "STEP_SKIP": {
        if (previewState?.status === "awaiting_confirm" || previewState?.status === "previewing") {
          await skipCurrentStep();
        }
        break;
      }

      case "USER_INTERVENED": {
        userIntervenedForStep = message.payload.stepId;
        cancelAutoExecute();
        break;
      }

      case "START_GOAL": {
        // User entered a goal in the popup
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
        break;
      }

      default:
        break;
    }
  };

  handler().catch((err) => console.error("[BAD] Message handler error:", err));
  return false; // not using sendResponse
});

// ─── Extension Lifecycle ─────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  // Set default tier to free
  chrome.storage.local.get(["tier"], (result) => {
    if (!result.tier) {
      chrome.storage.local.set({ tier: "free", autoExecute: false });
    }
  });
});
