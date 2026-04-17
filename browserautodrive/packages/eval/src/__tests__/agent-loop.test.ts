// AgentLoop OODA integration tests
const {
  AgentLoop,
  AgentStateMachine,
  MAX_ACTIONS_PER_GOAL,
  MAX_RETRIES,
} = require("@browserautodrive/core");
const { ActionValidator, SafetyGuard } = require("@browserautodrive/safety");

function createMockSnapshot(overrides: any = {}) {
  return {
    url: "https://example.com",
    title: "Example",
    screenshot: "base64",
    accessibilityTree: { role: "root", name: "page", children: [] },
    interactiveElements: [],
    viewportSize: { width: 1280, height: 720 },
    scrollPosition: { x: 0, y: 0 },
    timestamp: Date.now(),
    ...overrides,
  };
}

function createMockDeps(actions: any[] = []) {
  let callIndex = 0;
  const actionQueue = [...actions];

  const llm = {
    complete: jest.fn().mockImplementation(async () => {
      const next = actionQueue[callIndex];
      callIndex++;
      if (next) {
        return {
          action: next,
          reasoning: `Step ${callIndex}`,
          confidence: next.confidence ?? 0.9,
        };
      }
      return {
        action: { type: "done", result: "No more actions", success: true },
        reasoning: "No more actions",
        confidence: 1.0,
      };
    }),
    validateApiKey: jest.fn().mockResolvedValue(true),
  };

  const browser = {
    executeAction: jest.fn().mockResolvedValue({ success: true }),
  };

  const observer = {
    observe: jest.fn().mockResolvedValue(createMockSnapshot()),
  };

  const guard = new SafetyGuard();

  const human = {
    askQuestion: jest.fn().mockResolvedValue("Continue"),
    confirmAction: jest.fn().mockResolvedValue(true),
  };

  return { llm, browser, observer, safety: guard, human };
}

describe("AgentLoop: OODA Cycle", () => {
  it("should complete a simple navigate-then-done goal", async () => {
    const { llm, browser, observer, safety, human } = createMockDeps([
      { type: "navigate", url: "https://example.com" },
      { type: "done", result: "Navigated successfully", success: true },
    ]);

    const loop = new AgentLoop({ llm, browser, observer, safety, human });

    const result = await loop.run(
      { objective: "Navigate to example.com", constraints: [], successCriteria: "Page loaded" },
      {}
    );

    expect(result.success).toBe(true);
    expect(result.actionsTaken).toBe(2);
    expect(result.finalState).toBe("complete");
    expect(observer.observe).toHaveBeenCalled();
    expect(llm.complete).toHaveBeenCalled();
  });

  it("should execute a multi-step click-type-click sequence", async () => {
    const { llm, browser, observer, safety, human } = createMockDeps([
      { type: "navigate", url: "https://example.com/search" },
      { type: "type", target: { selector: "#search", confidence: 0.9 }, text: "test", description: "Type search" },
      { type: "click", target: { selector: "#submit", confidence: 0.9 }, description: "Submit" },
      { type: "done", result: "Search completed", success: true },
    ]);

    const loop = new AgentLoop({ llm, browser, observer, safety, human });
    const result = await loop.run(
      { objective: "Search for test", constraints: [], successCriteria: "Results shown" },
      {}
    );

    expect(result.success).toBe(true);
    expect(result.actionsTaken).toBe(4);
    expect(browser.executeAction).toHaveBeenCalledTimes(3); // navigate, type, click (done doesn't execute)
  });

  it("should handle action failures with retry", async () => {
    const { llm, browser, observer, safety, human } = createMockDeps([
      { type: "click", target: { selector: "#btn", confidence: 0.9 }, description: "Click button" },
      { type: "done", result: "Done after retry", success: true },
    ]);

    // First click fails, then recovery + retry succeeds
    browser.executeAction
      .mockRejectedValueOnce(new Error("Element not found"))
      .mockResolvedValue({ success: true });

    const loop = new AgentLoop({ llm, browser, observer, safety, human, config: { maxRetries: 3 } });
    const result = await loop.run(
      { objective: "Click the button", constraints: [], successCriteria: "Button clicked" },
      {}
    );

    expect(result.success).toBe(true);
  });

  it("should request human help after max retries exceeded", async () => {
    const { llm, browser, observer, safety, human } = createMockDeps();

    let llmCallCount = 0;
    llm.complete.mockImplementation(async () => {
      llmCallCount++;
      if (llmCallCount <= 3) {
        return {
          action: { type: "click", target: { selector: "#missing", confidence: 0.9 }, description: "Click missing" },
          reasoning: "Trying to click",
          confidence: 0.9,
        };
      }
      return {
        action: { type: "done", result: "Done after human help", success: true },
        reasoning: "Resolving after human assist",
        confidence: 1.0,
      };
    });

    browser.executeAction.mockRejectedValue(new Error("Element not found"));
    human.askQuestion.mockResolvedValueOnce("Continue");

    const loop = new AgentLoop({ llm, browser, observer, safety, human, config: { maxRetries: 3 } });
    const result = await loop.run(
      { objective: "Click the missing button", constraints: [], successCriteria: "Clicked" },
      {}
    );

    expect(human.askQuestion).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.finalState).toBe("complete");
  });

  it("should enforce max actions limit", async () => {
    const { llm, browser, observer, safety, human } = createMockDeps();

    // Generate more actions than the limit
    const manyActions = Array(55).fill({
      type: "click",
      target: { selector: "#btn", confidence: 0.9 },
      description: "Click",
    });
    let idx = 0;
    llm.complete.mockImplementation(async () => ({
      action: manyActions[idx++] || { type: "done", result: "max exceeded", success: false },
      reasoning: "clicking",
      confidence: 0.9,
    }));

    const loop = new AgentLoop({ llm, browser, observer, safety, human, config: { maxActions: 5 } });
    const result = await loop.run(
      { objective: "Click many times", constraints: [], successCriteria: "All clicked" },
      {}
    );

    expect(result.success).toBe(false);
    expect(result.actionsTaken).toBeLessThanOrEqual(5);
  });

  it("should route high-stakes actions through human confirmation", async () => {
    const { llm, browser, observer, safety, human } = createMockDeps([
      { type: "submit", target: { selector: "#purchase", confidence: 1.0, text: "Pay Now" }, description: "Submit payment" },
      { type: "done", result: "Payment submitted", success: true },
    ]);

    const loop = new AgentLoop({ llm, browser, observer, safety, human });
    const result = await loop.run(
      { objective: "Purchase item", constraints: [], successCriteria: "Payment submitted" },
      {}
    );

    expect(human.confirmAction).toHaveBeenCalled();
  });

  it("should cancel when human rejects action", async () => {
    const { llm, browser, observer, safety, human } = createMockDeps([
      { type: "submit", target: { selector: "#purchase", confidence: 1.0, text: "Pay Now" }, description: "Submit payment" },
    ]);

    human.confirmAction.mockResolvedValue(false);
    human.askQuestion.mockResolvedValue("Cancel");

    const loop = new AgentLoop({ llm, browser, observer, safety, human });
    const result = await loop.run(
      { objective: "Purchase item", constraints: [], successCriteria: "Payment submitted" },
      {}
    );

    expect(human.confirmAction).toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("should track full action history", async () => {
    const { llm, browser, observer, safety, human } = createMockDeps([
      { type: "navigate", url: "https://example.com" },
      { type: "click", target: { selector: "#link", confidence: 0.9 }, description: "Click link" },
      { type: "done", result: "Done", success: true },
    ]);

    const loop = new AgentLoop({ llm, browser, observer, safety, human });
    const result = await loop.run(
      { objective: "Click a link", constraints: [], successCriteria: "Clicked" },
      {}
    );

    expect(result.history).toHaveLength(3);
    expect(result.history[0].action.type).toBe("navigate");
    expect(result.history[1].action.type).toBe("click");
    expect(result.history[2].action.type).toBe("done");
  });

  it("should pass last 5 history entries to LLM for context", async () => {
    const { llm, browser, observer, safety, human } = createMockDeps([
      { type: "navigate", url: "https://example.com" },
      { type: "click", target: { selector: "#a", confidence: 0.9 }, description: "a" },
      { type: "click", target: { selector: "#b", confidence: 0.9 }, description: "b" },
      { type: "click", target: { selector: "#c", confidence: 0.9 }, description: "c" },
      { type: "done", result: "Done", success: true },
    ]);

    const loop = new AgentLoop({ llm, browser, observer, safety, human });
    await loop.run(
      { objective: "Click things", constraints: [], successCriteria: "All clicked" },
      {}
    );

    // Check that the last LLM call had history context
    const lastCall = llm.complete.mock.calls[llm.complete.mock.calls.length - 1];
    expect(lastCall[0].history).toBeDefined();
    expect(lastCall[0].history.length).toBeLessThanOrEqual(5);
  });
});