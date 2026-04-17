// GST-12: Final Evaluation + Performance Benchmarks
// Measures throughput, latency, and quality metrics for the AgentLoop pipeline

const {
  GoalParser,
  Planner,
  AgentLoop,
  SessionMemory,
  Logger,
  LogLevel,
} = require("@browserautodrive/core");
const { SafetyGuard } = require("@browserautodrive/safety");

// ─── Benchmark Helpers ─────────────────────────────────────────────────────────

function createBenchDeps(actionCount: number = 6) {
  let callIdx = 0;
  const llm = {
    complete: jest.fn().mockImplementation(async () => {
      callIdx++;
      if (callIdx < actionCount) {
        return {
          action: { type: "click", target: { selector: `#btn-${callIdx}`, confidence: 0.9 }, description: `Click ${callIdx}` },
          reasoning: `Step ${callIdx}`,
          confidence: 0.9,
        };
      }
      return { action: { type: "done", result: "Completed", success: true }, reasoning: "Done", confidence: 1.0 };
    }),
    validateApiKey: jest.fn().mockResolvedValue(true),
  };

  const browser = {
    executeAction: jest.fn().mockResolvedValue({ success: true }),
  };

  const observer = {
    observe: jest.fn().mockResolvedValue({
      url: "https://example.com",
      title: "Benchmark",
      screenshot: "base64",
      accessibilityTree: { role: "root", name: "page", children: [] },
      interactiveElements: [],
      viewportSize: { width: 1280, height: 720 },
      scrollPosition: { x: 0, y: 0 },
      timestamp: Date.now(),
    }),
  };

  const safety = new SafetyGuard();
  const human = {
    askQuestion: jest.fn().mockResolvedValue("Continue"),
    confirmAction: jest.fn().mockResolvedValue(true),
  };

  return { llm, browser, observer, safety, human };
}

// ─── Benchmark: GoalParser throughput ─────────────────────────────────────────

describe("Benchmark: GoalParser throughput", () => {
  it("should parse 100 goals in under 100ms", () => {
    const parser = new GoalParser();
    const goals = [
      "Book a flight from SFO to JFK on 2026-05-01.",
      "Search for TypeScript tutorials on Google.",
      "Fill out the registration form with my details.",
      "Navigate to https://example.com and click login.",
      "Extract all product prices from the catalog page.",
    ];

    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      parser.parse(goals[i % goals.length]);
    }
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
  });
});

// ─── Benchmark: Planner throughput ────────────────────────────────────────────

describe("Benchmark: Planner throughput", () => {
  it("should plan 100 goals in under 100ms", () => {
    const parser = new GoalParser();
    const planner = new Planner();
    const goals = [
      "Book a flight from SFO to JFK on 2026-05-01.",
      "Search for TypeScript tutorials on Google.",
      "Fill out the registration form with my details.",
      "Navigate to https://example.com and click login.",
      "Extract all product prices from the catalog page.",
    ];

    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      const parsed = parser.parse(goals[i % goals.length]);
      planner.createPlan(parsed.goal);
    }
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
  });
});

// ─── Benchmark: AgentLoop execution ──────────────────────────────────────────

describe("Benchmark: AgentLoop execution", () => {
  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should execute 10-step loop in under 200ms (mocked I/O)", async () => {
    const { llm, browser, observer, safety, human } = createBenchDeps(10);

    const loop = new AgentLoop({ llm, browser, observer, safety, human });
    const start = Date.now();
    const result = await loop.run(
      { objective: "Benchmark 10-step task", constraints: [], successCriteria: "Done" },
      {}
    );
    const elapsed = Date.now() - start;

    expect(result.success).toBe(true);
    expect(elapsed).toBeLessThan(200);
  });

  it("should execute 50-step loop in under 500ms (mocked I/O)", async () => {
    const { llm, browser, observer, safety, human } = createBenchDeps(50);

    const loop = new AgentLoop({ llm, browser, observer, safety, human, config: { maxActions: 60 } });
    const start = Date.now();
    const result = await loop.run(
      { objective: "Benchmark 50-step task", constraints: [], successCriteria: "Done" },
      {}
    );
    const elapsed = Date.now() - start;

    expect(result.success).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });
});

// ─── Evaluation: Quality metrics ──────────────────────────────────────────────

describe("Evaluation: Quality metrics", () => {
  it("should complete the flight booking golden path successfully", async () => {
    const { llm, browser, observer, safety, human } = createBenchDeps(6);

    const parser = new GoalParser();
    const planner = new Planner();
    const parsed = parser.parse("Book a flight from SFO to JFK on 2026-05-01.");
    const plan = planner.createPlan(parsed.goal);

    const loop = new AgentLoop({ llm, browser, observer, safety, human });
    const result = await loop.run(parsed.goal, {}, plan);

    expect(result.success).toBe(true);
    expect(result.actionsTaken).toBe(6);
    expect(result.finalState).toBe("complete");
    expect(result.result).toContain("Completed");
  });

  it("should handle 5 consecutive goals without degradation", async () => {
    const goals = [
      "Book a flight from SFO to JFK.",
      "Search for hotels in NYC.",
      "Fill out the contact form.",
      "Navigate to https://example.com.",
      "Extract product prices.",
    ];

    const results = [];

    for (const goalInput of goals) {
      const { llm, browser, observer, safety, human } = createBenchDeps(3);

      const parser = new GoalParser();
      const planner = new Planner();
      const parsed = parser.parse(goalInput);
      const plan = planner.createPlan(parsed.goal);

      const loop = new AgentLoop({ llm, browser, observer, safety, human });
      const result = await loop.run(parsed.goal, {}, plan);
      results.push(result);
    }

    expect(results.every((r) => r.success)).toBe(true);
    expect(results.every((r) => r.finalState === "complete")).toBe(true);
  });

  it("should track session state correctly through execution", async () => {
    const { llm, browser, observer, safety, human } = createBenchDeps(5);

    const loop = new AgentLoop({ llm, browser, observer, safety, human });
    await loop.run(
      { objective: "Multi-step task", constraints: [], successCriteria: "Done" },
      {}
    );

    const session = loop.getSessionState();
    expect(session).not.toBeNull();
    expect(session!.history.length).toBe(5);
    expect(session!.goal.objective).toContain("Multi-step");
  });
});

// ─── Evaluation: Logger integration ───────────────────────────────────────────

describe("Evaluation: Logger integration", () => {
  let logger: InstanceType<typeof Logger>;

  beforeEach(() => {
    logger = new Logger(LogLevel.DEBUG);
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should log agent lifecycle events", async () => {
    const { llm, browser, observer, safety, human } = createBenchDeps(3);

    // Use logger.timed to measure the full execution
    const result = await logger.timed("agent_execution", async () => {
      const loop = new AgentLoop({ llm, browser, observer, safety, human });
      return loop.run(
        { objective: "Logged task", constraints: [], successCriteria: "Done" },
        {}
      );
    });

    expect(result.success).toBe(true);
    const entries = logger.getEntries();
    expect(entries.some((e: any) => e.message.includes("agent_execution"))).toBe(true);
  });
});
