// BrowserAutoDrive — Message Router Tests
// Unit tests for the message router, handlers, and validators.

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { MessageRouter } from "../message-router";
import type { MessageHandler } from "../message-router";
import { validateExtensionMessage, getValidationErrorMessage } from "../message-validator";
import type { ExtensionMessage } from "../../shared/messages";

// ─── Mock Chrome APIs ────────────────────────────────────────────────────────

const mockChrome = {
  runtime: {
    id: "test-extension-id",
    onMessage: {
      addListener: jest.fn(),
    },
    sendMessage: jest.fn(async () => undefined),
    getContexts: jest.fn(async () => []),
  },
  tabs: {
    sendMessage: jest.fn(async () => undefined),
    query: jest.fn(async () => [{ id: 123 }]),
  },
  storage: {
    local: {
      get: jest.fn().mockImplementation((
        _keys: unknown,
        callback: (value: { tier: string; autoExecute: boolean }) => void
      ) => {
        callback({ tier: "free", autoExecute: false });
      }),
      set: jest.fn(),
    },
  },
};

// @ts-ignore
global.chrome = mockChrome;

const getRuntimeListener = (): ((
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean) => mockChrome.runtime.onMessage.addListener.mock.calls[0][0] as any;

const asMessageHandler = (fn: ReturnType<typeof jest.fn>): MessageHandler =>
  fn as unknown as MessageHandler;

// ─── Test Data ───────────────────────────────────────────────────────────────

const validPreviewStepMessage: ExtensionMessage = {
  type: "PREVIEW_STEP",
  payload: {
    stepId: "step-123",
    stepNumber: 1,
    totalSteps: 3,
    selector: "#button",
    action: "click",
    reasoning: "Click the button",
    tier: "free",
  },
};

const validElementSnapshotMessage: ExtensionMessage = {
  type: "ELEMENT_SNAPSHOT",
  payload: {
    stepId: "step-123",
    snapshot: {
      elementRect: {
        x: 100,
        y: 200,
        width: 50,
        height: 30,
        top: 200,
        left: 100,
      },
      tagName: "button",
      text: "Click me",
      ariaLabel: "Submit button",
    },
  },
};

const validStepConfirmMessage: ExtensionMessage = {
  type: "STEP_CONFIRM",
  payload: {
    stepId: "step-123",
  },
};

const validClearPreviewMessage: ExtensionMessage = {
  type: "CLEAR_PREVIEW",
  payload: {},
};

// ─── Message Router Tests ────────────────────────────────────────────────────

describe("MessageRouter", () => {
  let router: MessageRouter;

  beforeEach(() => {
    router = new MessageRouter();
    jest.clearAllMocks();
  });

  afterEach(() => {
    router.destroy();
  });

  describe("Initialization", () => {
    it("should initialize successfully", () => {
      router.initialize();
      expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalled();
    });

    it("should not initialize twice", () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      router.initialize();
      router.initialize();
      expect(consoleSpy).toHaveBeenCalledWith("[BAD] Message Router already initialized");
      consoleSpy.mockRestore();
    });
  });

  describe("Route Registration", () => {
    it("should register a route", () => {
      const handler = jest.fn();
      router.registerRoute({
        type: "TEST_MESSAGE",
        handler: asMessageHandler(handler),
        description: "Test message handler",
      });

      expect(router.getRouteCount()).toBe(1);
      expect(router.getRegisteredRoutes()).toHaveLength(1);
      expect(router.getRegisteredRoutes()[0].type).toBe("TEST_MESSAGE");
    });

    it("should register multiple routes", () => {
      const handlers = [
        { type: "MSG1", handler: asMessageHandler(jest.fn()), description: "Message 1" },
        { type: "MSG2", handler: asMessageHandler(jest.fn()), description: "Message 2" },
      ];

      router.registerRoutes(handlers);
      expect(router.getRouteCount()).toBe(2);
    });

    it("should not register duplicate routes", () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const handler = jest.fn();

      router.registerRoute({ type: "TEST", handler: asMessageHandler(handler), description: "Test" });
      router.registerRoute({
        type: "TEST",
        handler: asMessageHandler(handler),
        description: "Test duplicate",
      });

      expect(router.getRouteCount()).toBe(1);
      expect(consoleSpy).toHaveBeenCalledWith("[BAD] Route already registered for type: TEST");
      consoleSpy.mockRestore();
    });
  });

  describe("Message Handling", () => {
    it("should handle valid messages", async () => {
      const handler = jest.fn().mockReturnValue(false);
      router.registerRoute({
        type: "TEST_MESSAGE",
        handler: asMessageHandler(handler),
        description: "Test handler",
      });

      router.initialize();

      // Get the registered listener
      const listener = getRuntimeListener();

      const sendResponse = jest.fn();
      const result = listener(
        { type: "TEST_MESSAGE", payload: {} },
        { id: "test-extension-id" },
        sendResponse
      );

      expect(result).toBe(false);
      expect(handler).toHaveBeenCalled();
    });

    it("should reject messages from invalid senders", () => {
      const handler = jest.fn();
      router.registerRoute({
        type: "TEST_MESSAGE",
        handler: asMessageHandler(handler),
        description: "Test handler",
      });

      router.initialize();

      const listener = getRuntimeListener();
      const sendResponse = jest.fn();
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      const result = listener(
        { type: "TEST_MESSAGE", payload: {} },
        { id: "invalid-extension-id" },
        sendResponse
      );

      expect(result).toBe(false);
      expect(handler).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith("[BAD] Invalid message sender");
      consoleSpy.mockRestore();
    });

    it("should reject invalid message structure", () => {
      const handler = jest.fn();
      router.registerRoute({
        type: "TEST_MESSAGE",
        handler: asMessageHandler(handler),
        description: "Test handler",
      });

      router.initialize();

      const listener = getRuntimeListener();
      const sendResponse = jest.fn();
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      const result = listener(
        { type: "TEST_MESSAGE" }, // Missing payload
        { id: "test-extension-id" },
        sendResponse
      );

      expect(result).toBe(false);
      expect(handler).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({
        error: expect.any(String),
        type: "VALIDATION_ERROR",
      });
      consoleSpy.mockRestore();
    });

    it("should handle async handlers", async () => {
      const handler = jest.fn(async () => undefined);
      router.registerRoute({
        type: "ASYNC_MESSAGE",
        handler: asMessageHandler(handler),
        description: "Async handler",
      });

      router.initialize();

      const listener = getRuntimeListener();
      const sendResponse = jest.fn();

      const result = listener(
        { type: "ASYNC_MESSAGE", payload: {} },
        { id: "test-extension-id" },
        sendResponse
      );

      expect(result).toBe(true); // Keep channel open for async
      expect(handler).toHaveBeenCalled();
    });

    it("should handle handler errors", async () => {
      const handler = jest.fn(async () => {
        throw new Error("Handler failed");
      });
      router.registerRoute({
        type: "FAILING_MESSAGE",
        handler: asMessageHandler(handler),
        description: "Failing handler",
      });

      router.initialize();

      const listener = getRuntimeListener();
      const sendResponse = jest.fn();
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      const result = listener(
        { type: "FAILING_MESSAGE", payload: {} },
        { id: "test-extension-id" },
        sendResponse
      );

      expect(result).toBe(true); // Async handler
      // Wait for promise to reject
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("Request/Response Pattern", () => {
    it("should generate unique request IDs", () => {
      const id1 = (router as any).generateRequestId();
      const id2 = (router as any).generateRequestId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^req_\d+_\d+$/);
    });

    it("should handle pending requests", () => {
      expect(router.getPendingRequestCount()).toBe(0);
    });
  });

  describe("Cleanup", () => {
    it("should destroy properly", () => {
      router.initialize();
      router.destroy();

      expect(router.getRouteCount()).toBe(0);
      expect(router.getPendingRequestCount()).toBe(0);
    });
  });
});

// ─── Message Validator Tests ─────────────────────────────────────────────────

describe("Message Validator", () => {
  describe("validateExtensionMessage", () => {
    it("should validate PREVIEW_STEP messages", () => {
      expect(validateExtensionMessage(validPreviewStepMessage)).toBe(true);
    });

    it("should validate ELEMENT_SNAPSHOT messages", () => {
      expect(validateExtensionMessage(validElementSnapshotMessage)).toBe(true);
    });

    it("should validate STEP_CONFIRM messages", () => {
      expect(validateExtensionMessage(validStepConfirmMessage)).toBe(true);
    });

    it("should validate CLEAR_PREVIEW messages", () => {
      expect(validateExtensionMessage(validClearPreviewMessage)).toBe(true);
    });

    it("should reject null messages", () => {
      expect(validateExtensionMessage(null)).toBe(false);
    });

    it("should reject non-object messages", () => {
      expect(validateExtensionMessage("string")).toBe(false);
      expect(validateExtensionMessage(123)).toBe(false);
    });

    it("should reject messages without type", () => {
      expect(validateExtensionMessage({ payload: {} })).toBe(false);
    });

    it("should reject messages without payload", () => {
      expect(validateExtensionMessage({ type: "TEST" })).toBe(false);
    });

    it("should reject unknown message types", () => {
      expect(validateExtensionMessage({ type: "UNKNOWN", payload: {} })).toBe(false);
    });

    it("should reject PREVIEW_STEP with invalid payload", () => {
      expect(
        validateExtensionMessage({
          type: "PREVIEW_STEP",
          payload: { stepId: "test" }, // Missing required fields
        })
      ).toBe(false);
    });

    it("should reject ELEMENT_SNAPSHOT with invalid snapshot", () => {
      expect(
        validateExtensionMessage({
          type: "ELEMENT_SNAPSHOT",
          payload: {
            stepId: "test",
            snapshot: { invalid: "data" },
          },
        })
      ).toBe(false);
    });

    it("should accept ELEMENT_SNAPSHOT with null snapshot", () => {
      expect(
        validateExtensionMessage({
          type: "ELEMENT_SNAPSHOT",
          payload: {
            stepId: "test",
            snapshot: null,
          },
        })
      ).toBe(true);
    });
  });

  describe("getValidationErrorMessage", () => {
    it("should return error for null message", () => {
      expect(getValidationErrorMessage(null)).toBe("Message must be an object");
    });

    it("should return error for message without type", () => {
      expect(getValidationErrorMessage({ payload: {} })).toBe(
        "Message must have a string 'type' field"
      );
    });

    it("should return error for message without payload", () => {
      expect(getValidationErrorMessage({ type: "TEST" })).toBe(
        "Message must have a 'payload' field"
      );
    });

    it("should return error for unknown message type", () => {
      expect(getValidationErrorMessage({ type: "UNKNOWN", payload: {} })).toBe(
        "Unknown message type: UNKNOWN"
      );
    });

    it("should return null for valid message", () => {
      expect(getValidationErrorMessage(validPreviewStepMessage)).toBeNull();
    });

    it("should return specific error for invalid PREVIEW_STEP", () => {
      const error = getValidationErrorMessage({
        type: "PREVIEW_STEP",
        payload: { stepId: "test" },
      });
      expect(error).toContain("Invalid PREVIEW_STEP payload");
    });
  });
});

// ─── Integration Tests ───────────────────────────────────────────────────────

describe("Message Flow Integration", () => {
  it("should handle complete preview flow", async () => {
    const router = new MessageRouter();
    const handler = jest.fn(
      (
        message: ExtensionMessage,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void
      ) => {
      if (message.type === "PREVIEW_STEP") {
        // Simulate content script response
        setTimeout(() => {
          sendResponse({
            type: "ELEMENT_SNAPSHOT",
            payload: {
              stepId: message.payload.stepId,
              snapshot: {
                elementRect: { x: 0, y: 0, width: 100, height: 50, top: 0, left: 0 },
                tagName: "button",
                text: "Click",
                ariaLabel: "Button",
              },
            },
          });
        }, 10);
      }
      return true; // Keep channel open
      }
    );

    router.registerRoute({
      type: "PREVIEW_STEP",
      handler: asMessageHandler(handler),
      description: "Preview step handler",
    });

    router.initialize();

    // Clean up
    router.destroy();
  });
});
