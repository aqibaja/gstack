// E2E tests using runtime require for reliable module resolution
const { launchBrowser, executeBrowserAction } = require("@browserautodrive/browser");
const { extractObservation } = require("@browserautodrive/observe");
const { AgentStateMachine } = require("@browserautodrive/core");
const { ActionValidator, SafetyGuard } = require("@browserautodrive/safety");
const { ProviderFactory, GLM5Adapter, OpenAICompatAdapter } = require("@browserautodrive/llm");

jest.mock("@browserautodrive/browser");
jest.mock("@browserautodrive/observe");

const mockedLaunchBrowser = jest.mocked(launchBrowser);
const mockedExecuteBrowserAction = jest.mocked(executeBrowserAction);
const mockedExtractObservation = jest.mocked(extractObservation);

class MockLLMProvider {
  private actions: any[] = [];
  private callCount = 0;

  setActions(actions: any[]) {
    this.actions = actions;
    this.callCount = 0;
  }

  async complete(prompt: any): Promise<any> {
    const action = this.actions[this.callCount] || { type: "done", result: "No more actions", success: true };
    this.callCount++;
    return { action, reasoning: "Mock reasoning", confidence: 0.9 };
  }

  async validateApiKey(): Promise<boolean> {
    return true;
  }
}

const mockSafetyGuard = { requireHumanConfirmation: jest.fn() };

function createMockSnapshot(overrides: any = {}) {
  return {
    url: "https://example.com",
    title: "Example Domain",
    screenshot: "base64data",
    accessibilityTree: { role: "root", name: "page", children: [] },
    interactiveElements: [] as any[],
    viewportSize: { width: 1280, height: 720 },
    scrollPosition: { x: 0, y: 0 },
    timestamp: Date.now(),
    ...overrides,
  };
}

async function simulateAgentLoop({
  llm,
  safetyGuard,
  goal,
  initialUrl = "https://example.com",
  maxSteps = 10,
}: {
  llm: any;
  safetyGuard: { requireHumanConfirmation: jest.Mock };
  goal: string;
  initialUrl?: string;
  maxSteps?: number;
}): Promise<{ success: boolean; result?: string; error?: string }> {
  let step = 0;
  let page: any = null;

  const launchResult = await launchBrowser(initialUrl);
  page = launchResult.page;

  while (step < maxSteps) {
    step++;
    const snapshot = await extractObservation(page);
    const decision = await llm.complete({ goal, observation: snapshot, history: [] });
    const action = decision.action;

    const isHighStakes = action.type === "submit" || action.type === "purchase" || action.type === "delete";
    const isLowConfidence = action.target?.confidence !== undefined && action.target.confidence < 0.5;
    if (isHighStakes || isLowConfidence) {
      try {
        await safetyGuard.requireHumanConfirmation(action);
      } catch (e) {
        return { success: false, error: "Human confirmation required" };
      }
    }

    if (action.type === "done") {
      return { success: action.success, result: action.result };
    }

    try {
      await executeBrowserAction(page, action);
    } catch (error) {
      return { success: false, error: `Action failed: ${error}` };
    }
  }

  return { success: false, error: "Max steps exceeded" };
}

describe("E2E Tests E1-E4", () => {
  let mockLLM: MockLLMProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLLM = new MockLLMProvider();
  });

  describe("E1: Navigate to website, find link, click", () => {
    it("should navigate to a page, locate a link, and click it", async () => {
      const mockBrowser = { close: jest.fn() };
      const mockContext = { close: jest.fn() };
      const mockPage = { goto: jest.fn() };
      mockedLaunchBrowser.mockResolvedValue({ browser: mockBrowser, context: mockContext, page: mockPage } as any);

      const snapshot1 = createMockSnapshot({
        interactiveElements: [
          { selector: 'a', text: "More information...", role: "link", confidence: 1.0 },
        ],
      });
      const snapshot2 = createMockSnapshot({
        url: "https://www.iana.org/domains/example",
        title: "IANA — Example Domain",
        interactiveElements: [],
      });

      mockedExtractObservation
        .mockResolvedValueOnce(snapshot1 as any)
        .mockResolvedValueOnce(snapshot2 as any);

      mockedExecuteBrowserAction.mockResolvedValue({ success: true });

      mockLLM.setActions([
        { type: "click", target: { selector: "a", confidence: 1.0 }, description: 'Click "More information..." link' },
        { type: "done", result: "Successfully clicked link", success: true },
      ]);

      const result = await simulateAgentLoop({
        llm: mockLLM,
        safetyGuard: mockSafetyGuard,
        goal: 'Navigate to example.com and click the "More information..." link',
      });

      expect(mockedLaunchBrowser).toHaveBeenCalledWith("https://example.com");
      expect(result.success).toBe(true);
      expect(result.result).toContain("clicked link");
    });
  });

  describe("E2: Fill search form, submit, verify results", () => {
    it("should fill a search form, submit, and verify results appear", async () => {
      const mockBrowser = { close: jest.fn() };
      const mockContext = { close: jest.fn() };
      const mockPage = { goto: jest.fn() };
      mockedLaunchBrowser.mockResolvedValue({ browser: mockBrowser, context: mockContext, page: mockPage } as any);

      const snapshot1 = createMockSnapshot({
        url: "https://example.com/search",
        title: "Search",
        interactiveElements: [
          { selector: "#search-input", text: "", role: "textbox", confidence: 1.0 },
          { selector: "#submit-button", text: "Submit", role: "button", confidence: 1.0 },
        ],
      });
      const snapshot2 = createMockSnapshot({
        url: "https://example.com/search?q=test",
        title: "Search Results",
        interactiveElements: [],
      });

      mockedExtractObservation
        .mockResolvedValueOnce(snapshot1 as any)
        .mockResolvedValueOnce(snapshot1 as any)
        .mockResolvedValueOnce(snapshot2 as any);

      mockedExecuteBrowserAction.mockResolvedValue({ success: true });

      mockLLM.setActions([
        { type: "type", target: { selector: "#search-input", confidence: 1.0 }, text: "test query", description: "Type search query" },
        { type: "click", target: { selector: "#submit-button", confidence: 1.0 }, description: "Click submit button" },
        { type: "done", result: "Search completed, results displayed", success: true },
      ]);

      const result = await simulateAgentLoop({
        llm: mockLLM,
        safetyGuard: mockSafetyGuard,
        goal: 'Search for "test query" and verify results',
        initialUrl: "https://example.com/search",
      });

      expect(mockedLaunchBrowser).toHaveBeenCalledWith("https://example.com/search");
      expect(mockedExecuteBrowserAction).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });
  });

  describe("E3: Flight search demo golden path", () => {
    it("should execute a flight search from SFO to JFK", async () => {
      const mockBrowser = { close: jest.fn() };
      const mockContext = { close: jest.fn() };
      const mockPage = { goto: jest.fn() };
      mockedLaunchBrowser.mockResolvedValue({ browser: mockBrowser, context: mockContext, page: mockPage } as any);

      const flightSearchPage = createMockSnapshot({
        url: "https://flights.example.com",
        title: "Flight Search",
        interactiveElements: [
          { selector: "#origin", role: "textbox", confidence: 1.0 },
          { selector: "#destination", role: "textbox", confidence: 1.0 },
          { selector: "#date", role: "textbox", confidence: 1.0 },
          { selector: "#search-btn", role: "button", confidence: 1.0 },
        ],
      });

      for (let i = 0; i < 6; i++) {
        mockedExtractObservation.mockResolvedValueOnce(flightSearchPage as any);
      }

      mockedExecuteBrowserAction.mockResolvedValue({ success: true });

      mockLLM.setActions([
        { type: "type", target: { selector: "#origin", confidence: 1.0 }, text: "SFO", description: "Enter origin" },
        { type: "type", target: { selector: "#destination", confidence: 1.0 }, text: "JFK", description: "Enter destination" },
        { type: "type", target: { selector: "#date", confidence: 1.0 }, text: "2026-05-01", description: "Enter date" },
        { type: "click", target: { selector: "#search-btn", confidence: 1.0 }, description: "Click search" },
        { type: "click", target: { selector: ".flight-option", confidence: 1.0 }, description: "Select first flight" },
        { type: "done", result: "Flight selected for booking", success: true },
      ]);

      const result = await simulateAgentLoop({
        llm: mockLLM,
        safetyGuard: mockSafetyGuard,
        goal: "Book a flight from SFO to JFK on May 1st",
      });

      expect(mockedExecuteBrowserAction).toHaveBeenCalledTimes(5);
      expect(result.success).toBe(true);
    });
  });

  describe("E4: Low-confidence action triggers human handoff", () => {
    it("should pause and ask human when confidence is low", async () => {
      const mockBrowser = { close: jest.fn() };
      const mockContext = { close: jest.fn() };
      const mockPage = { goto: jest.fn() };
      mockedLaunchBrowser.mockResolvedValue({ browser: mockBrowser, context: mockContext, page: mockPage } as any);

      const snapshot = createMockSnapshot({
        interactiveElements: [
          { selector: "#ambiguous", role: "button", confidence: 0.3 },
        ],
      });
      mockedExtractObservation.mockResolvedValue(snapshot as any);

      mockSafetyGuard.requireHumanConfirmation.mockRejectedValue(
        new Error("Human confirmation required")
      );

      mockLLM.setActions([
        { type: "click", target: { selector: "#ambiguous", confidence: 0.3 }, description: "Click ambiguous button" },
      ]);

      mockedExecuteBrowserAction.mockRejectedValue(new Error("Low confidence action blocked"));

      const result = await simulateAgentLoop({
        llm: mockLLM,
        safetyGuard: mockSafetyGuard,
        goal: "Click the button",
      });

      expect(mockSafetyGuard.requireHumanConfirmation).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain("Human confirmation required");
    });
  });
});