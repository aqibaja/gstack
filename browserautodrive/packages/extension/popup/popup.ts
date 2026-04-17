// BrowserAutoDrive — Popup UI
// Renders step cards, handles confirm/skip, manages free vs pro auto-execute.

// ─── Types ───────────────────────────────────────────────────────────────────

interface StepData {
  stepId: string;
  stepNumber: number;
  totalSteps: number;
  action: string;
  reasoning: string;
  selector: string;
  value?: string;
}

type TierType = "free" | "pro";

// ─── Constants ───────────────────────────────────────────────────────────────

const ACTION_ICONS: Record<string, string> = {
  navigate: "\u2192",   // →
  click: "\u25CF",      // ●
  type: "\u270E",       // ✎
  scroll: "\u2195",     // ↕
  select: "\u25BE",     // ▾
  submit: "\u2714",     // ✔
  extract: "\u2B07",    // ⬇
  wait: "\u23F3",       // ⏳
  done: "\u2714",       // ✔
  default: "\u25A0",    // ■
};

// ─── DOM References ──────────────────────────────────────────────────────────

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing DOM element: #${id}`);
  return el;
};

const idleState = $("idle-state");
const stepState = $("step-state");
const doneState = $("done-state");
const tierBadge = $("tier-badge");
const stepNumber = $("step-number");
const stepProgress = $("step-progress");
const actionIcon = $("action-icon");
const actionType = $("action-type");
const stepReasoning = $("step-reasoning");
const targetSelector = $("target-selector");
const confirmBtn = $("confirm-btn") as HTMLButtonElement;
const skipBtn = $("skip-btn") as HTMLButtonElement;
const autoExecuteSection = $("auto-execute-section");
const autoExecuteToggle = $("auto-execute-toggle") as HTMLInputElement;
const startBtn = $("start-btn");
const resetBtn = $("reset-btn");
const goalInput = $("goal-input") as HTMLInputElement;

// ─── State ───────────────────────────────────────────────────────────────────

let currentTier: TierType = "free";
let currentStep: StepData | null = null;
let userIntervened = false;

// ─── Tier Management ─────────────────────────────────────────────────────────

function applyTier(tier: TierType): void {
  currentTier = tier;
  tierBadge.textContent = tier === "pro" ? "Pro" : "Free";
  tierBadge.className = `badge badge-${tier}`;

  if (tier === "pro") {
    autoExecuteSection.classList.remove("hidden");
  } else {
    autoExecuteSection.classList.add("hidden");
    autoExecuteToggle.checked = false;
  }
}

function loadTierConfig(): void {
  chrome.storage.local.get(["tier", "autoExecute"], (result) => {
    const tier: TierType = result.tier === "pro" ? "pro" : "free";
    applyTier(tier);
    if (tier === "pro" && result.autoExecute === true) {
      autoExecuteToggle.checked = true;
    }
  });
}

// ─── Step Rendering ──────────────────────────────────────────────────────────

function showState(state: "idle" | "step" | "done"): void {
  idleState.classList.toggle("hidden", state !== "idle");
  stepState.classList.toggle("hidden", state !== "step");
  doneState.classList.toggle("hidden", state !== "done");
}

function renderStepCard(step: StepData): void {
  currentStep = step;
  showState("step");

  stepNumber.textContent = `Step ${step.stepNumber}`;
  stepProgress.textContent = `of ${step.totalSteps}`;
  actionIcon.textContent = ACTION_ICONS[step.action] || ACTION_ICONS.default;
  actionType.textContent = step.action.charAt(0).toUpperCase() + step.action.slice(1);
  stepReasoning.textContent = step.reasoning;
  targetSelector.textContent = step.selector;

  confirmBtn.disabled = false;
  skipBtn.disabled = false;

  skipBtn.textContent = "Skip";

  // Auto-execute is orchestrated by the service worker.
  // Popup only tracks user intervention to cancel it.
  userIntervened = false;
}

// Mark user intervention — service worker handles canceling auto-execute
function markUserIntervened(): void {
  userIntervened = true;
  if (currentStep) {
    chrome.runtime.sendMessage({
      type: "USER_INTERVENED",
      payload: { stepId: currentStep.stepId },
    });
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

function handleConfirm(): void {
  if (!currentStep) return;
  confirmBtn.disabled = true;
  skipBtn.disabled = true;

  chrome.runtime.sendMessage({
    type: "STEP_CONFIRM",
    payload: { stepId: currentStep.stepId },
  });
}

function handleSkip(): void {
  if (!currentStep) return;
  confirmBtn.disabled = true;
  skipBtn.disabled = true;

  chrome.runtime.sendMessage({
    type: "STEP_SKIP",
    payload: { stepId: currentStep.stepId },
  });
}

function handleStartGoal(): void {
  const goal = goalInput.value.trim();
  if (!goal) return;

  chrome.runtime.sendMessage({
    type: "START_GOAL",
    payload: { goal },
  });
}

function handleReset(): void {
  currentStep = null;
  showState("idle");
  goalInput.value = "";
}

// ─── Event Listeners ─────────────────────────────────────────────────────────

confirmBtn.addEventListener("click", () => {
  markUserIntervened();
  handleConfirm();
});

skipBtn.addEventListener("click", () => {
  markUserIntervened();
  handleSkip();
});

startBtn.addEventListener("click", handleStartGoal);
resetBtn.addEventListener("click", handleReset);

// Cancel auto-execute on any user interaction with the step card
stepState.addEventListener("mouseenter", markUserIntervened);
stepState.addEventListener("focusin", markUserIntervened);

autoExecuteToggle.addEventListener("change", () => {
  // Save preference — service worker reads it for auto-execute orchestration
  chrome.storage.local.set({ autoExecute: autoExecuteToggle.checked });
});

// ─── Message Listener (from service worker) ──────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  switch (message.type) {
    case "PREVIEW_STEP":
      renderStepCard({
        stepId: message.payload.stepId,
        stepNumber: message.payload.stepNumber,
        totalSteps: message.payload.totalSteps,
        action: message.payload.action,
        reasoning: message.payload.reasoning,
        selector: message.payload.selector,
        value: message.payload.value,
      });
      return false;

    case "CLEAR_PREVIEW":
      if (message.payload?.done) {
        showState("done");
      } else {
        showState("idle");
      }
      currentStep = null;
      return false;

    case "TIER_CONFIG":
      applyTier(message.payload.tier);
      return false;

    default:
      return false;
  }
});

// ─── Init ────────────────────────────────────────────────────────────────────

loadTierConfig();
