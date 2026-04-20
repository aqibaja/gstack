// BrowserAutoDrive — Agent Loop Integration for Service Worker
// Wires the OODA loop to service worker lifecycle with LLM, content script, and storage.

import type {
  ActionResultMessage,
  DOMSnapshotPayload,
  ExecuteActionMessage,
  PopupStepState,
} from "../shared/messages";
import type { AgentDecision, PromptContext, StructuredGoal, ExecutionPlan, PageSnapshot, Action, ActionResult, ActionHistoryEntry } from "@browserautodrive/core";
import { AgentStateMachine, GoalParser, Planner, SessionMemory } from "@browserautodrive/core";
import { llmBridge } from "./llm-bridge";

const MAX_ACTIONS_PER_GOAL = 50;
const MAX_RETRIES = 3;
const NAVIGATION_SETTLE_MS = 2000;
const STORAGE_KEY_AGENT_STATE = "bad.agentState";
const ALARM_NAME = "bad.agentKeepalive";
const ALARM_PERIOD_MS = 25 * 1000;

export type AgentLoopStatus = "idle" | "running" | "paused" | "completed" | "failed" | "cancelled";

interface AgentLoopState {
  sessionId: string;
  goal: string;
  tabId: number;
  status: AgentLoopStatus;
  currentStepIndex: number;
  actionCount: number;
  retryCount: number;
  history: ActionHistoryEntry[];
  startedAt: number;
  updatedAt: number;
}

let loopState: AgentLoopState | null = null;
let isRunning = false;
let abortController: AbortController | null = null;

function createDefaultState(goal: string, tabId: number): AgentLoopState {
  return {
    sessionId: crypto.randomUUID(),
    goal,
    tabId,
    status: "idle",
    currentStepIndex: 0,
    actionCount: 0,
    retryCount: 0,
    history: [],
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function persistState(): Promise<void> {
  if (!loopState) return;
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY_AGENT_STATE]: loopState }, () => resolve());
  });
}

async function loadState(): Promise<AgentLoopState | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_AGENT_STATE], (result) => {
      resolve(result[STORAGE_KEY_AGENT_STATE] || null);
    });
  });
}

async function createKeepaliveAlarm(): Promise<void> {
  return new Promise((resolve) => {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MS / 60000 }, () => {
      console.log("[BAD][agent-loop] Keepalive alarm created");
      resolve();
    });
  });
}

async function clearKeepaliveAlarm(): Promise<void> {
  return new Promise((resolve) => {
    chrome.alarms.get(ALARM_NAME, (alarm) => {
      if (alarm) {
        chrome.alarms.clear(ALARM_NAME, () => {
          console.log("[BAD][agent-loop] Keepalive alarm cleared");
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

async function setLoopTerminalStatus(status: AgentLoopStatus): Promise<void> {
  if (!loopState) return;
  loopState.status = status;
  loopState.updatedAt = Date.now();
  await persistState();
  await clearKeepaliveAlarm();
}

async function requestSnapshot(tabId: number): Promise<DOMSnapshotPayload | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "GET_SNAPSHOT" });
    if (response && response.type === "SNAPSHOT_RESPONSE") {
      return response.payload;
    }
    return null;
  } catch (error) {
    console.warn("[BAD][agent-loop] Failed to get snapshot:", error);
    return null;
  }
}

async function executeAction(tabId: number, action: Action, stepId: string): Promise<ActionResult> {
  try {
    const payload: ExecuteActionMessage["payload"] = {
      stepId,
      action: action.type as ExecuteActionMessage["payload"]["action"],
    };

    switch (action.type) {
      case "click":
      case "type":
      case "select":
        payload.selector = action.target?.selector;
        if (action.type === "type") payload.value = action.text;
        if (action.type === "select") payload.value = action.value;
        break;
      case "navigate":
        payload.url = action.url;
        break;
      case "scroll":
        payload.action = "scroll";
        break;
      case "wait":
        payload.action = "wait";
        payload.timeoutMs = action.durationMs;
        break;
      case "done":
        return { success: action.success, error: undefined };
      case "ask_human":
        return { success: false, error: "Human assist not yet implemented in autonomous mode" };
      case "extract":
        return { success: false, error: "Extract action not yet implemented" };
      default:
        return { success: false, error: `Unsupported action type: ${(action as any).type}` };
    }

    const result = await chrome.tabs.sendMessage(tabId, {
      type: "EXECUTE_ACTION",
      payload,
    });

    if (result?.status === "failed") {
      return { success: false, error: result.errorMessage || "Action failed" };
    }

    if (action.type === "navigate") {
      await new Promise((r) => setTimeout(r, NAVIGATION_SETTLE_MS));
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Action execution failed",
    };
  }
}

function snapshotToPageSnapshot(snapshot: DOMSnapshotPayload): PageSnapshot {
  return {
    url: snapshot.url,
    title: snapshot.title,
    timestamp: snapshot.timestamp,
    accessibilityTree: snapshot.accessibilityTree as any,
    interactiveElements: snapshot.interactiveElements as any,
    screenshot: "",
    viewportSize: snapshot.viewportSize,
    scrollPosition: snapshot.scrollPosition,
    formFields: snapshot.formFields,
  };
}

export async function startAgentLoop(goal: string, tabId: number): Promise<{ sessionId: string }> {
  if (isRunning) {
    throw new Error("Agent loop already running");
  }

  const isConfigured = await llmBridge.isConfigured();
  if (!isConfigured) {
    throw new Error("LLM provider not configured. Set API key in options page.");
  }

  loopState = createDefaultState(goal, tabId);
  loopState.status = "running";
  isRunning = true;
  abortController = new AbortController();

  await persistState();
  await createKeepaliveAlarm();

  void runLoop().catch((error) => {
    console.error("[BAD][agent-loop] Loop failed:", error);
    if (loopState) {
      loopState.status = "failed";
      loopState.updatedAt = Date.now();
      void persistState();
      void clearKeepaliveAlarm();
    }
    isRunning = false;
  });

  return { sessionId: loopState.sessionId };
}

async function runLoop(): Promise<void> {
  if (!loopState) return;

  const sm = new AgentStateMachine();
  const memory = new SessionMemory();
  const goalParser = new GoalParser();
  const planner = new Planner();

  let parsedGoal: StructuredGoal;
  try {
    const parseResult = goalParser.parse(loopState.goal);
    parsedGoal = parseResult.goal;
  } catch (error) {
    console.error("[BAD][agent-loop] Goal parsing failed:", error);
    await setLoopTerminalStatus("failed");
    return;
  }

  let plan: ExecutionPlan;
  try {
    plan = planner.createPlan(parsedGoal);
  } catch (error) {
    console.error("[BAD][agent-loop] Plan generation failed:", error);
    await setLoopTerminalStatus("failed");
    return;
  }

  memory.init(parsedGoal, plan);

  console.log(`[BAD][agent-loop] Starting loop: ${plan.steps.length} steps, ~${plan.estimatedActions} actions`);

  let stepIndex = 0;
  let consecutiveFailures = 0;

  while (isRunning && loopState.status === "running") {
    if (abortController?.signal.aborted) {
      await setLoopTerminalStatus("cancelled");
      break;
    }

    if (loopState.actionCount >= MAX_ACTIONS_PER_GOAL) {
      console.warn("[BAD][agent-loop] Max actions exceeded");
      await setLoopTerminalStatus("failed");
      break;
    }

    try {
      const snapshot = await requestSnapshot(loopState.tabId);
      if (!snapshot) {
        consecutiveFailures++;
        if (consecutiveFailures > MAX_RETRIES) {
          await setLoopTerminalStatus("failed");
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      const pageSnapshot = snapshotToPageSnapshot(snapshot);
      const history = memory.getRecentHistory(5);

      const promptContext: PromptContext = {
        goal: parsedGoal,
        plan,
        stepIndex,
        observation: pageSnapshot,
        history,
        availableActions: ["navigate", "click", "type", "scroll", "select", "wait", "done"],
      };

      let decision: AgentDecision;
      try {
        decision = await llmBridge.complete(promptContext);
      } catch (error) {
        console.error("[BAD][agent-loop] LLM decision failed:", error);
        consecutiveFailures++;
        if (consecutiveFailures > MAX_RETRIES) {
          await setLoopTerminalStatus("failed");
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      consecutiveFailures = 0;

      if (decision.action.type === "done") {
        console.log("[BAD][agent-loop] Goal completed");
        await setLoopTerminalStatus("completed");
        break;
      }

      const stepId = `step-${loopState.sessionId}-${stepIndex}`;
      const actionResult = await executeAction(loopState.tabId, decision.action, stepId);

      const entry: ActionHistoryEntry = {
        step: stepIndex,
        action: decision.action,
        result: actionResult,
        timestamp: Date.now(),
      };

      loopState.actionCount++;
      loopState.history.push(entry);
      loopState.updatedAt = Date.now();
      memory.recordAction(entry);

      if (!actionResult.success) {
        loopState.retryCount++;
        console.warn(`[BAD][agent-loop] Action failed (${loopState.retryCount}/${MAX_RETRIES}): ${actionResult.error}`);

        if (loopState.retryCount >= MAX_RETRIES) {
          await setLoopTerminalStatus("failed");
          break;
        }
      } else {
        loopState.retryCount = 0;
        stepIndex++;
        loopState.currentStepIndex = stepIndex;
      }

      await persistState();
    } catch (error) {
      console.error("[BAD][agent-loop] Loop iteration error:", error);
      consecutiveFailures++;
      if (consecutiveFailures > MAX_RETRIES) {
        await setLoopTerminalStatus("failed");
        break;
      }
    }
  }
}

export function stopAgentLoop(): void {
  isRunning = false;
  abortController?.abort();
  if (loopState) {
    loopState.status = "cancelled";
    loopState.updatedAt = Date.now();
    void persistState();
    void clearKeepaliveAlarm();
  }
}

export async function getAgentLoopState(): Promise<AgentLoopState | null> {
  if (loopState) return loopState;
  return loadState();
}

export async function restoreAgentLoop(): Promise<void> {
  const saved = await loadState();
  if (saved && saved.status === "running") {
    loopState = saved;
    loopState.status = "paused";
    await persistState();
    console.log("[BAD][agent-loop] Restored session from storage:", saved.sessionId);
  }
}
