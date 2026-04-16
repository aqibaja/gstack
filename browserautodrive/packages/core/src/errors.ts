// BrowserAutoDrive — Error Boundaries
// Graceful error handling for production use

import { getLogger } from "./logger";

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean = true,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export const ErrorCodes = {
  GOAL_PARSE_FAILED: "GOAL_PARSE_FAILED",
  PLAN_GENERATION_FAILED: "PLAN_GENERATION_FAILED",
  LLM_API_ERROR: "LLM_API_ERROR",
  LLM_EMPTY_RESPONSE: "LLM_EMPTY_RESPONSE",
  LLM_PARSE_ERROR: "LLM_PARSE_ERROR",
  BROWSER_LAUNCH_FAILED: "BROWSER_LAUNCH_FAILED",
  BROWSER_CRASH: "BROWSER_CRASH",
  ACTION_FAILED: "ACTION_FAILED",
  SAFETY_BLOCKED: "SAFETY_BLOCKED",
  MAX_ACTIONS_EXCEEDED: "MAX_ACTIONS_EXCEEDED",
  MAX_RETRIES_EXCEEDED: "MAX_RETRIES_EXCEEDED",
  HUMAN_CANCELLED: "HUMAN_CANCELLED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  UNKNOWN: "UNKNOWN",
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/**
 * Wrap an async operation with error boundary.
 * Logs the error and returns null instead of throwing.
 */
export async function errorBoundary<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T | null = null
): Promise<T | null> {
  const logger = getLogger();
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AgentError) {
      logger.error(`${label}: ${err.code} — ${err.message}`, err, err.context);
    } else {
      logger.error(`${label}: unexpected error`, err instanceof Error ? err : new Error(String(err)));
    }
    return fallback;
  }
}

/**
 * Wrap an async operation with retry.
 * Retries up to `maxRetries` times with exponential backoff.
 */
export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 500
): Promise<T> {
  const logger = getLogger();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        logger.warn(`${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`, {
          error: lastError.message,
        });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw new AgentError(
    `${label} failed after ${maxRetries + 1} attempts: ${lastError?.message}`,
    ErrorCodes.MAX_RETRIES_EXCEEDED,
    false
  );
}

/**
 * Create a timeout wrapper for async operations.
 */
export function withTimeout<T>(
  label: string,
  fn: () => Promise<T>,
  timeoutMs: number = 30000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AgentError(
        `${label} timed out after ${timeoutMs}ms`,
        ErrorCodes.SESSION_EXPIRED,
        true
      ));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
