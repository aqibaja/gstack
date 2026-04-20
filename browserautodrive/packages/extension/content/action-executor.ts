// BrowserAutoDrive — Action Executor Content Script
// Receives EXECUTE_ACTION from service worker, performs DOM manipulation, returns ACTION_RESULT.

import type { ActionType, ExecuteActionMessage, ActionResultMessage } from "../shared/messages";

const MAX_SELECTOR_LENGTH = 500;

function logActionEvent(stepId: string, phase: string, action: ActionType, status: string, metadata: Record<string, unknown>): void {
  console.log(`[BAD][action-executor] step=${stepId} phase=${phase} action=${action} status=${status}`, metadata);
}

function isInteractable(el: Element): boolean {
  if (!el.isConnected) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  if ((el as HTMLInputElement).disabled) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  return true;
}

function resolveElement(selector: string): Element | null {
  if (!selector || selector.length > MAX_SELECTOR_LENGTH) return null;
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

async function executeClick(selector: string): Promise<{ success: boolean; errorCode?: string; errorMessage?: string }> {
  const el = resolveElement(selector);
  if (!el) return { success: false, errorCode: "element_not_found", errorMessage: `Element not found for selector: ${selector.slice(0, 100)}` };
  if (!el.isConnected) return { success: false, errorCode: "element_not_connected", errorMessage: "Element is not connected to the DOM" };
  if (!isInteractable(el)) return { success: false, errorCode: "element_not_interactable", errorMessage: "Element is not interactable" };

  try {
    el.scrollIntoView({ block: "center", inline: "center" });
    await new Promise((r) => setTimeout(r, 100));

    if (el instanceof HTMLElement) {
      el.click();
    } else {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    return { success: true };
  } catch (err) {
    return { success: false, errorCode: "click_failed", errorMessage: err instanceof Error ? err.message : "Click action failed" };
  }
}

async function executeType(selector: string, value: string): Promise<{ success: boolean; errorCode?: string; errorMessage?: string }> {
  if (!value) return { success: false, errorCode: "value_required", errorMessage: "No value provided for type action" };

  const el = resolveElement(selector);
  if (!el) return { success: false, errorCode: "element_not_found", errorMessage: `Element not found for selector: ${selector.slice(0, 100)}` };

  const tag = el.tagName.toLowerCase();
  const isInput = tag === "input" || tag === "textarea";
  const isContentEditable = el.getAttribute("contenteditable") === "true";

  if (!isInput && !isContentEditable) return { success: false, errorCode: "field_not_editable", errorMessage: "Target is not an editable element" };

  if (isInput && (el as HTMLInputElement).disabled) return { success: false, errorCode: "element_not_interactable", errorMessage: "Field is disabled" };
  if (isInput && (el as HTMLInputElement).readOnly) return { success: false, errorCode: "element_not_interactable", errorMessage: "Field is readonly" };

  try {
    el.scrollIntoView({ block: "center", inline: "center" });
    await new Promise((r) => setTimeout(r, 100));
    (el as HTMLElement).focus();

    if (isInput) {
      const inputEl = el as HTMLInputElement | HTMLTextAreaElement;
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      )?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(inputEl, value);
      } else {
        inputEl.value = value;
      }

      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      inputEl.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      el.textContent = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    return { success: true };
  } catch (err) {
    return { success: false, errorCode: "type_failed", errorMessage: err instanceof Error ? err.message : "Type action failed" };
  }
}

async function executeSelect(selector: string, value: string): Promise<{ success: boolean; errorCode?: string; errorMessage?: string }> {
  if (!value) return { success: false, errorCode: "value_required", errorMessage: "No value provided for select action" };

  const el = resolveElement(selector);
  if (!el) return { success: false, errorCode: "element_not_found", errorMessage: `Element not found for selector: ${selector.slice(0, 100)}` };

  if (!(el instanceof HTMLSelectElement)) return { success: false, errorCode: "unsupported_target", errorMessage: "Target is not a select element" };

  try {
    const selectEl = el as HTMLSelectElement;
    let optionFound = false;

    for (const option of selectEl.options) {
      if (option.value === value || option.textContent?.trim() === value) {
        selectEl.value = option.value;
        optionFound = true;
        break;
      }
    }

    if (!optionFound) return { success: false, errorCode: "option_not_found", errorMessage: `Option not found: ${value}` };

    selectEl.dispatchEvent(new Event("input", { bubbles: true }));
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));

    return { success: true };
  } catch (err) {
    return { success: false, errorCode: "select_failed", errorMessage: err instanceof Error ? err.message : "Select action failed" };
  }
}

async function executeNavigate(url: string): Promise<{ success: boolean; errorCode?: string; errorMessage?: string }> {
  if (!url) return { success: false, errorCode: "url_required", errorMessage: "No URL provided for navigate action" };

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { success: false, errorCode: "url_invalid", errorMessage: `Invalid URL: ${url}` };
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return { success: false, errorCode: "protocol_not_allowed", errorMessage: `Protocol not allowed: ${parsedUrl.protocol}` };
  }

  try {
    window.location.href = url;
    return { success: true };
  } catch (err) {
    return { success: false, errorCode: "navigate_failed", errorMessage: err instanceof Error ? err.message : "Navigation failed" };
  }
}

async function executeScroll(direction: "up" | "down", amount: number = 300): Promise<{ success: boolean; errorCode?: string; errorMessage?: string }> {
  try {
    const delta = direction === "up" ? -amount : amount;
    window.scrollBy({ top: delta, behavior: "smooth" });
    await new Promise((r) => setTimeout(r, 300));
    return { success: true };
  } catch (err) {
    return { success: false, errorCode: "scroll_failed", errorMessage: err instanceof Error ? err.message : "Scroll action failed" };
  }
}

async function executeWait(durationMs: number = 1000): Promise<{ success: boolean; errorCode?: string; errorMessage?: string }> {
  try {
    await new Promise((r) => setTimeout(r, durationMs));
    return { success: true };
  } catch (err) {
    return { success: false, errorCode: "wait_failed", errorMessage: err instanceof Error ? err.message : "Wait action failed" };
  }
}

async function executeAction(payload: ExecuteActionMessage["payload"]): Promise<ActionResultMessage["payload"]> {
  const startTime = Date.now();
  const urlBefore = window.location.href;
  const { stepId, action, selector, value, url, timeoutMs } = payload;

  logActionEvent(stepId, "validate", action, "start", { selector, value: value ? "[redacted]" : undefined, url });

  let result: { success: boolean; errorCode?: string; errorMessage?: string };

  switch (action) {
    case "click":
      if (!selector) {
        result = { success: false, errorCode: "selector_required", errorMessage: "No selector provided for click action" };
      } else {
        result = await executeClick(selector);
      }
      break;

    case "type":
      if (!selector) {
        result = { success: false, errorCode: "selector_required", errorMessage: "No selector provided for type action" };
      } else {
        result = await executeType(selector, value || "");
      }
      break;

    case "select":
      if (!selector) {
        result = { success: false, errorCode: "selector_required", errorMessage: "No selector provided for select action" };
      } else {
        result = await executeSelect(selector, value || "");
      }
      break;

    case "navigate":
      result = await executeNavigate(url || "");
      break;

    case "scroll":
      result = await executeScroll("down", 300);
      break;

    case "wait":
      result = await executeWait(timeoutMs || 1000);
      break;

    default:
      result = { success: false, errorCode: "unsupported_action", errorMessage: `Unsupported action type: ${action}` };
  }

  const durationMs = Date.now() - startTime;
  const urlAfter = window.location.href;

  let targetInfo: ActionResultMessage["payload"]["target"] | undefined;
  if (selector) {
    const el = resolveElement(selector);
    if (el) {
      targetInfo = {
        selector,
        tagName: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim().slice(0, 200) || undefined,
      };
    }
  }

  logActionEvent(stepId, "result", action, result.success ? "success" : "failed", {
    durationMs,
    errorCode: result.errorCode,
    urlBefore,
    urlAfter,
  });

  return {
    stepId,
    action,
    status: result.success ? "success" : "failed",
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    urlBefore,
    urlAfter,
    timestamp: Date.now(),
    durationMs,
    target: targetInfo,
  };
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  if (message && typeof message === "object" && "type" in message && message.type === "EXECUTE_ACTION") {
    const execMessage = message as ExecuteActionMessage;

    executeAction(execMessage.payload)
      .then((result) => {
        chrome.runtime.sendMessage({
          type: "ACTION_RESULT",
          payload: result,
        } as ActionResultMessage);

        sendResponse(result);
      })
      .catch((error) => {
        const errorResult: ActionResultMessage["payload"] = {
          stepId: execMessage.payload.stepId,
          action: execMessage.payload.action,
          status: "failed",
          errorCode: "execution_error",
          errorMessage: error instanceof Error ? error.message : "Unknown execution error",
          urlBefore: window.location.href,
          urlAfter: window.location.href,
          timestamp: Date.now(),
          durationMs: 0,
        };

        chrome.runtime.sendMessage({
          type: "ACTION_RESULT",
          payload: errorResult,
        } as ActionResultMessage);

        sendResponse(errorResult);
      });

    return true;
  }

  return false;
});

export {};
