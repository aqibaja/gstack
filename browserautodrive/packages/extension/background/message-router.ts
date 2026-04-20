// BrowserAutoDrive — Message Router
// Centralized message routing, validation, and request/response handling.

import type { ExtensionMessage } from "../shared/messages";
import { getValidationErrorMessage } from "./message-validator";

// ─── Types ───────────────────────────────────────────────────────────────────

export type MessageHandler = (
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | void | Promise<void>;

export interface MessageRoute {
  type: string;
  handler: MessageHandler;
  description: string;
}

export interface RequestConfig {
  timeout?: number;
  retries?: number;
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// ─── Message Router Class ────────────────────────────────────────────────────

export class MessageRouter {
  private routes: Map<string, MessageRoute> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private requestIdCounter = 0;
  private isInitialized = false;

  // ─── Initialization ──────────────────────────────────────────────────────

  initialize(): void {
    if (this.isInitialized) {
      console.warn("[BAD] Message Router already initialized");
      return;
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      return this.handleMessage(message, sender, sendResponse);
    });

    this.isInitialized = true;
    console.log("[BAD] Message Router initialized");
  }

  // ─── Route Registration ──────────────────────────────────────────────────

  registerRoute(route: MessageRoute): void {
    if (this.routes.has(route.type)) {
      console.warn(`[BAD] Route already registered for type: ${route.type}`);
      return;
    }

    this.routes.set(route.type, route);
    console.log(`[BAD] Registered route: ${route.type} - ${route.description}`);
  }

  registerRoutes(routes: MessageRoute[]): void {
    routes.forEach((route) => this.registerRoute(route));
  }

  // ─── Message Handling ────────────────────────────────────────────────────

  private handleMessage(
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): boolean {
    // Validate sender
    if (!this.validateSender(sender)) {
      console.warn("[BAD] Invalid message sender");
      return false;
    }

    // Validate message structure
    if (!this.validateMessage(message)) {
      console.warn("[BAD] Invalid message structure:", message);
      sendResponse({
        error: getValidationErrorMessage(message) ?? "Invalid message",
        type: "VALIDATION_ERROR",
      });
      return false;
    }

    const typedMessage = message as ExtensionMessage;
    const route = this.routes.get(typedMessage.type);

    if (!route) {
      console.warn(`[BAD] No route found for message type: ${typedMessage.type}`);
      return false;
    }

    try {
      const result = route.handler(typedMessage, sender, sendResponse);

      // If handler returns a promise, handle it asynchronously
      if (result instanceof Promise) {
        result.catch((error) => {
          console.error(`[BAD] Error in handler for ${typedMessage.type}:`, error);
          sendResponse({
            error: error.message || "Handler error",
            type: "ERROR",
          });
        });
        return true; // Keep message channel open for async response
      }

      return typeof result === "boolean" ? result : false;
    } catch (error) {
      console.error(`[BAD] Synchronous error in handler for ${typedMessage.type}:`, error);
      sendResponse({
        error: error instanceof Error ? error.message : "Handler error",
        type: "ERROR",
      });
      return false;
    }
  }

  // ─── Validation ──────────────────────────────────────────────────────────

  private validateSender(sender: chrome.runtime.MessageSender): boolean {
    // Only accept messages from our own extension
    return sender.id === chrome.runtime.id;
  }

  private validateMessage(message: unknown): message is ExtensionMessage {
    if (!message || typeof message !== "object") {
      return false;
    }

    const msg = message as Record<string, unknown>;

    if (typeof msg.type !== "string" || msg.type.length === 0) {
      return false;
    }

    const noPayloadTypes = new Set([
      "CLEAR_PREVIEW",
      "GET_SNAPSHOT",
      "START_OBSERVING",
      "STOP_OBSERVING",
      "POPUP_READY",
      "RESET_POPUP",
    ]);

    if (!("payload" in msg) && !noPayloadTypes.has(msg.type)) {
      return false;
    }

    return true;
  }

  // ─── Request/Response Pattern ────────────────────────────────────────────

  async sendRequest<T = unknown>(
    target: "tab" | "popup" | "background",
    message: ExtensionMessage,
    config: RequestConfig = {}
  ): Promise<T> {
    const { timeout = 5000, retries = 0 } = config;
    const requestId = this.generateRequestId();

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout: timeoutId,
      });

      const payload =
        "payload" in message && message.payload && typeof message.payload === "object"
          ? (message.payload as Record<string, unknown>)
          : {};

      this.sendMessageToTarget(target, {
        ...message,
        payload: {
          ...payload,
          requestId,
        },
      }).catch((error) => {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        reject(error);
      });
    });
  }

  handleResponse(response: unknown): void {
    if (!response || typeof response !== "object") {
      return;
    }

    const res = response as Record<string, unknown>;
    const requestId = res.requestId as string | undefined;

    if (!requestId) {
      return;
    }

    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);

    if (res.error) {
      pending.reject(new Error(res.error as string));
    } else {
      pending.resolve(res.data);
    }
  }

  // ─── Message Sending ─────────────────────────────────────────────────────

  async sendMessageToTab(tabId: number, message: unknown): Promise<void> {
    try {
      await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
      // Content script may not be injected yet — silently ignore
      console.warn("[BAD] Failed to send message to tab", tabId, err);
    }
  }

  async sendMessageToPopup(message: unknown): Promise<void> {
    try {
      // Use chrome.runtime.getContexts (MV3) to find popup views
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ["POPUP" as chrome.runtime.ContextType],
      });

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

  async sendMessageToAll(message: unknown): Promise<void> {
    await Promise.allSettled([
      this.sendMessageToPopup(message),
      // Note: We can't send to all tabs without knowing tab IDs
      // This would need to be handled by the caller
    ]);
  }

  private async sendMessageToTarget(
    target: "tab" | "popup" | "background",
    message: unknown
  ): Promise<void> {
    switch (target) {
      case "tab":
        // Would need tab ID from caller
        throw new Error("Tab ID required for tab messages");
      case "popup":
        await this.sendMessageToPopup(message);
        break;
      case "background":
        // Messages to background are handled by the router itself
        break;
    }
  }

  // ─── Utilities ───────────────────────────────────────────────────────────

  private generateRequestId(): string {
    return `req_${++this.requestIdCounter}_${Date.now()}`;
  }

  getRegisteredRoutes(): MessageRoute[] {
    return Array.from(this.routes.values());
  }

  getRouteCount(): number {
    return this.routes.size;
  }

  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  destroy(): void {
    // Clear all pending requests
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Router destroyed"));
    }
    this.pendingRequests.clear();

    this.routes.clear();
    this.isInitialized = false;
    console.log("[BAD] Message Router destroyed");
  }
}

// ─── Singleton Instance ─────────────────────────────────────────────────────

export const messageRouter = new MessageRouter();
