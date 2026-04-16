// GST-11: Hardening tests — Logger, Error Boundaries
const { Logger, LogLevel, getLogger, resetLogger, AgentError, ErrorCodes, errorBoundary, withRetry, withTimeout } = require("@browserautodrive/core");

describe("Logger", () => {
  let logger: InstanceType<typeof Logger>;

  beforeEach(() => {
    logger = new Logger(LogLevel.DEBUG);
    // Suppress console output during tests
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetLogger();
  });

  it("should log messages at or above the minimum level", () => {
    const debugLogger = new Logger(LogLevel.DEBUG);
    debugLogger.debug("debug msg");
    debugLogger.info("info msg");
    debugLogger.warn("warn msg");
    debugLogger.error("error msg");

    expect(debugLogger.getEntries().length).toBe(4);
  });

  it("should filter messages below minimum level", () => {
    const warnLogger = new Logger(LogLevel.WARN);
    warnLogger.debug("debug msg");
    warnLogger.info("info msg");
    warnLogger.warn("warn msg");
    warnLogger.error("error msg");

    expect(warnLogger.getEntries().length).toBe(2);
    expect(warnLogger.getEntries()[0].level).toBe("WARN");
  });

  it("should include structured fields in log entries", () => {
    logger.info("Action executed", { actionType: "click", selector: "#btn" });
    const entries = logger.getEntries();

    expect(entries[0].fields).toEqual({ actionType: "click", selector: "#btn" });
  });

  it("should return recent entries", () => {
    for (let i = 0; i < 20; i++) {
      logger.info(`Message ${i}`);
    }

    const recent = logger.getRecent(5);
    expect(recent.length).toBe(5);
    expect(recent[4].message).toBe("Message 19");
  });

  it("should cap entries at maxEntries", () => {
    const smallLogger = new Logger(LogLevel.DEBUG, 5);
    for (let i = 0; i < 10; i++) {
      smallLogger.info(`Message ${i}`);
    }

    expect(smallLogger.getEntries().length).toBe(5);
  });

  it("should time async operations", async () => {
    const result = await logger.timed("test operation", async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 42;
    });

    expect(result).toBe(42);
    const entries = logger.getEntries();
    expect(entries.some((e: any) => e.message.includes("completed"))).toBe(true);
  });

  it("should log errors from timed operations", async () => {
    await expect(
      logger.timed("failing operation", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    const entries = logger.getEntries();
    expect(entries.some((e: any) => e.level === "ERROR")).toBe(true);
  });

  it("should provide singleton logger via getLogger", () => {
    const logger1 = getLogger();
    const logger2 = getLogger();
    expect(logger1).toBe(logger2);
  });

  it("should clear entries", () => {
    logger.info("test");
    logger.clear();
    expect(logger.getEntries().length).toBe(0);
  });
});

describe("AgentError", () => {
  it("should create error with code and recoverable flag", () => {
    const err = new AgentError("Action failed", ErrorCodes.ACTION_FAILED, true);
    expect(err.name).toBe("AgentError");
    expect(err.code).toBe("ACTION_FAILED");
    expect(err.recoverable).toBe(true);
    expect(err.message).toBe("Action failed");
  });

  it("should include context", () => {
    const err = new AgentError("LLM failed", ErrorCodes.LLM_API_ERROR, true, { provider: "glm5", status: 429 });
    expect(err.context).toEqual({ provider: "glm5", status: 429 });
  });
});

describe("errorBoundary", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetLogger();
  });

  it("should return result on success", async () => {
    const result = await errorBoundary("test", async () => 42);
    expect(result).toBe(42);
  });

  it("should return fallback on failure", async () => {
    const result = await errorBoundary("test", async () => {
      throw new Error("boom");
    }, null);
    expect(result).toBeNull();
  });

  it("should return default fallback (null) on failure", async () => {
    const result = await errorBoundary("test", async () => {
      throw new Error("boom");
    });
    expect(result).toBeNull();
  });

  it("should handle AgentError with context", async () => {
    const result = await errorBoundary("test", async () => {
      throw new AgentError("custom error", ErrorCodes.SAFETY_BLOCKED, false, { action: "navigate" });
    });
    expect(result).toBeNull();
  });
});

describe("withRetry", () => {
  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetLogger();
  });

  it("should succeed on first attempt", async () => {
    const result = await withRetry("test", async () => "ok");
    expect(result).toBe("ok");
  });

  it("should retry on failure and eventually succeed", async () => {
    let attempt = 0;
    const result = await withRetry("test", async () => {
      attempt++;
      if (attempt < 3) throw new Error("fail");
      return "ok";
    }, 3, 10);

    expect(result).toBe("ok");
    expect(attempt).toBe(3);
  });

  it("should throw AgentError after max retries", async () => {
    await expect(
      withRetry("test", async () => {
        throw new Error("always fails");
      }, 2, 10)
    ).rejects.toThrow("failed after 3 attempts");
  });
});

describe("withTimeout", () => {
  it("should resolve within timeout", async () => {
    const result = await withTimeout("test", async () => {
      await new Promise((r) => setTimeout(r, 10));
      return "ok";
    }, 1000);
    expect(result).toBe("ok");
  });

  it("should reject on timeout", async () => {
    await expect(
      withTimeout("test", async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return "slow";
      }, 50)
    ).rejects.toThrow("timed out");
  });
});
