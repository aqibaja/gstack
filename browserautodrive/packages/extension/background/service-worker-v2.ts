// BrowserAutoDrive — Background Service Worker
// Orchestrates preview flow between popup and content scripts.
// Manages step execution, auto-execute (Pro), and tier enforcement.

import { messageRouter } from "./message-router";
import { registerMessageHandlers, getPreviewState, resetPreviewState } from "./message-handlers";
import { validateExtensionMessage, getValidationErrorMessage } from "./message-validator";

// ─── Initialization ──────────────────────────────────────────────────────────

function initializeServiceWorker(): void {
  console.log("[BAD] Initializing service worker...");

  // Initialize message router
  messageRouter.initialize();

  // Register message handlers
  registerMessageHandlers();

  // Register extension lifecycle handlers
  registerLifecycleHandlers();

  console.log("[BAD] Service worker initialized successfully");
}

// ─── Enhanced Message Handling ────────────────────────────────────────────────

function setupEnhancedMessageHandling(): void {
  // Override the default message handler with enhanced validation
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Validate sender
    if (sender.id !== chrome.runtime.id) {
      console.warn("[BAD] Invalid message sender:", sender.id);
      return false;
    }

    // Validate message structure
    const validationError = getValidationErrorMessage(message);
    if (validationError) {
      console.warn("[BAD] Message validation failed:", validationError, message);
      sendResponse({
        error: validationError,
        type: "VALIDATION_ERROR",
      });
      return false;
    }

    // Validate message against shared types
    if (!validateExtensionMessage(message)) {
      console.warn("[BAD] Message does not match shared types:", message);
      sendResponse({
        error: "Message does not match expected schema",
        type: "SCHEMA_ERROR",
      });
      return false;
    }

    // Message is valid, let the router handle it
    return false; // Let the router's listener handle it
  });
}

// ─── Lifecycle Handlers ──────────────────────────────────────────────────────

function registerLifecycleHandlers(): void {
  // Handle extension installation
  chrome.runtime.onInstalled.addListener((details) => {
    console.log("[BAD] Extension installed:", details.reason);

    // Set default tier to free
    chrome.storage.local.get(["tier"], (result) => {
      if (!result.tier) {
        chrome.storage.local.set({ tier: "free", autoExecute: false });
        console.log("[BAD] Set default tier to free");
      }
    });

    // Reset any stale state
    resetPreviewState();
  });

  // Handle extension startup
  chrome.runtime.onStartup.addListener(() => {
    console.log("[BAD] Extension started");
    resetPreviewState();
  });

  // Handle service worker suspension
  chrome.runtime.onSuspend.addListener(() => {
    console.log("[BAD] Service worker suspending...");
    // Clean up resources
    messageRouter.destroy();
  });

  // Handle service worker suspension cancellation
  chrome.runtime.onSuspendCanceled.addListener(() => {
    console.log("[BAD] Service worker suspension canceled");
  });
}

// ─── Error Handling ──────────────────────────────────────────────────────────

function setupGlobalErrorHandling(): void {
  // Handle unhandled promise rejections
  self.addEventListener("unhandledrejection", (event) => {
    console.error("[BAD] Unhandled promise rejection:", event.reason);
    // Prevent the default handling
    event.preventDefault();
  });

  // Handle global errors
  self.addEventListener("error", (event) => {
    console.error("[BAD] Global error:", event.error);
    // Prevent the default handling
    event.preventDefault();
  });
}

// ─── Debug Utilities ─────────────────────────────────────────────────────────

function setupDebugUtilities(): void {
  // Expose debug utilities in development
  if (typeof chrome !== "undefined" && chrome.runtime) {
    // Add debug commands
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === "DEBUG_GET_STATE") {
        sendResponse({
          previewState: getPreviewState(),
          registeredRoutes: messageRouter.getRegisteredRoutes().map((r) => ({
            type: r.type,
            description: r.description,
          })),
          routeCount: messageRouter.getRouteCount(),
          pendingRequestCount: messageRouter.getPendingRequestCount(),
        });
        return true;
      }

      if (message.type === "DEBUG_RESET_STATE") {
        resetPreviewState();
        sendResponse({ success: true });
        return true;
      }

      return false;
    });
  }
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

// Initialize the service worker
initializeServiceWorker();

// Setup enhanced message handling (overrides basic router handling)
setupEnhancedMessageHandling();

// Setup global error handling
setupGlobalErrorHandling();

// Setup debug utilities
setupDebugUtilities();

console.log("[BAD] Service worker script loaded");