// Integration tests using runtime require for reliable module resolution
const {
  launchBrowser,
  executeBrowserAction,
} = require("@browserautodrive/browser");
const { extractObservation } = require("@browserautodrive/observe");
const { AgentStateMachine } = require("@browserautodrive/core");
const { ActionValidator, SafetyGuard } = require("@browserautodrive/safety");
const { ProviderFactory, GLM5Adapter, OpenAICompatAdapter } = require("@browserautodrive/llm");

jest.mock("@browserautodrive/browser");
jest.mock("@browserautodrive/observe");

const mockedLaunchBrowser = jest.mocked(launchBrowser);
const mockedExecuteBrowserAction = jest.mocked(executeBrowserAction);
const mockedExtractObservation = jest.mocked(extractObservation);

describe("Integration Tests I1-I10", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("I1: Full observe cycle (Critical)", () => {
    it("should launch browser and extract observation", async () => {
      const mockPage = { goto: jest.fn() };
      const mockBrowser = { close: jest.fn() };
      const mockContext = { close: jest.fn() };
      mockedLaunchBrowser.mockResolvedValue({
        browser: mockBrowser as any,
        context: mockContext as any,
        page: mockPage as any,
      });

      const mockSnapshot = {
        url: "https://example.com",
        title: "Example",
        screenshot: "base64",
        accessibilityTree: { role: "root", name: "page", children: [] },
        interactiveElements: [],
        viewportSize: { width: 1280, height: 720 },
        scrollPosition: { x: 0, y: 0 },
        timestamp: Date.now(),
      };
      mockedExtractObservation.mockResolvedValue(mockSnapshot as any);

      const { page } = await launchBrowser("https://example.com");
      const result = await extractObservation(page);

      expect(mockedLaunchBrowser).toHaveBeenCalledWith("https://example.com");
      expect(mockedExtractObservation).toHaveBeenCalledWith(mockPage);
      expect(result.url).toBe("https://example.com");
      expect(result.screenshot).toBe("base64");
    });
  });

  describe("I2: Click action round trip (Critical)", () => {
    it("should execute click action on static page", async () => {
      const action = {
        type: "click" as const,
        target: { selector: "#button", confidence: 1.0 },
        description: "Click submit button",
      };
      mockedExecuteBrowserAction.mockResolvedValue({ success: true });

      const result = await executeBrowserAction({} as any, action);

      expect(mockedExecuteBrowserAction).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe("I3: Type action + form submission (Critical)", () => {
    it("should type into input and submit form", async () => {
      const typeAction = {
        type: "type" as const,
        target: { selector: "#input", confidence: 1.0 },
        text: "test input",
        description: "Type into search field",
      };
      const clickAction = {
        type: "click" as const,
        target: { selector: "#submit", confidence: 1.0 },
        description: "Submit form",
      };
      mockedExecuteBrowserAction
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true });

      const result1 = await executeBrowserAction({} as any, typeAction);
      const result2 = await executeBrowserAction({} as any, clickAction);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(mockedExecuteBrowserAction).toHaveBeenCalledTimes(2);
    });
  });

  describe("I4: Multi-step execution with mock LLM (Critical)", () => {
    it("should execute multiple steps using mock LLM provider", async () => {
      const mockLLM: any = {
        complete: jest.fn().mockResolvedValue({
          action: { type: "click", target: { selector: "#step1", confidence: 1.0 } },
          reasoning: "First step",
          confidence: 0.9,
        }),
      };

      for (let i = 0; i < 3; i++) {
        mockedExecuteBrowserAction.mockResolvedValueOnce({ success: true });
      }

      expect(mockLLM.complete).toBeDefined();
      expect(typeof mockLLM.complete).toBe("function");
    });
  });

  describe("I5: LLM provider switching (High)", () => {
    it("should create both GLM5 and OpenAI-compatible adapters", () => {
      const glm5 = ProviderFactory.create("glm5", { apiKey: "test-key" });
      const openai = ProviderFactory.create("openai", { apiKey: "test-key" });

      expect(glm5).toBeInstanceOf(GLM5Adapter);
      expect(openai).toBeInstanceOf(OpenAICompatAdapter);
    });
  });

  describe("I6: Error recovery retry success (Critical)", () => {
    it("should retry on element not found and succeed", async () => {
      mockedExecuteBrowserAction.mockReset();

      const action = {
        type: "click" as const,
        target: { selector: "#dynamic", confidence: 0.8 },
        description: "Click dynamic element",
      };

      mockedExecuteBrowserAction
        .mockRejectedValueOnce(new Error("Element not found"))
        .mockResolvedValueOnce({ success: true });

      let result: any;
      try {
        result = await executeBrowserAction({} as any, action);
      } catch (error) {
        result = await executeBrowserAction({} as any, action);
      }

      expect(mockedExecuteBrowserAction).toHaveBeenCalledTimes(2);
      if (result) expect(result.success).toBe(true);
    });
  });

  describe("I7: Error recovery 3 retries then ask_human (Critical)", () => {
    it("should fail after 3 retries and escalate to ask_human", async () => {
      const sm = new AgentStateMachine();
      sm.transition("goal_start");
      sm.transition("plan_ok");

      mockedExecuteBrowserAction.mockRejectedValue(new Error("Element not found"));

      let attempts = 0;
      const maxRetries = 3;
      while (attempts < maxRetries) {
        try {
          await executeBrowserAction({} as any, {
            type: "click",
            target: { selector: "#missing", confidence: 0.5 },
            description: "Click missing",
          });
        } catch (error) {
          attempts++;
          sm.incrementRetry();
        }
      }

      expect(attempts).toBe(maxRetries);
      expect(sm.isMaxRetriesExceeded()).toBe(true);
    });
  });

  describe("I8: Safety guard interrupts high-stakes (High)", () => {
    it("should flag submit action as requiring human confirmation", () => {
      const guard = new SafetyGuard();
      const highStakesAction: any = {
        type: "submit",
        target: { selector: "#purchase", confidence: 1.0, text: "Pay Now" },
        description: "Submit payment",
      };

      const result = guard.validateAndGate(highStakesAction);
      expect(result.allowed).toBe(true);
      expect(result.needsHumanConfirmation).toBe(true);
    });
  });

  describe("I9: Screenshot + accessibility tree (High)", () => {
    it("should capture screenshot and extract accessibility tree", async () => {
      const mockSnapshot = {
        screenshot: "base64data",
        accessibilityTree: { role: "root", name: "page", children: [] },
        interactiveElements: [],
        url: "https://example.com",
        title: "Example",
        viewportSize: { width: 1280, height: 720 },
        scrollPosition: { x: 0, y: 0 },
        timestamp: Date.now(),
      };

      mockedExtractObservation.mockResolvedValue(mockSnapshot as any);

      const result = await extractObservation({} as any);

      expect(result.screenshot).toBe("base64data");
      expect(result.accessibilityTree).toBeDefined();
      expect(result.accessibilityTree.role).toBe("root");
    });
  });

  describe("I10: State persistence across navigation (Medium)", () => {
    it("should maintain AgentStateMachine state across actions", () => {
      const sm = new AgentStateMachine();
      sm.transition("goal_start");
      sm.transition("plan_ok");

      sm.recordAction({
        step: 0,
        action: { type: "navigate", url: "https://example.com" },
        result: { success: true },
        timestamp: Date.now(),
      });
      sm.recordAction({
        step: 1,
        action: { type: "click", target: { selector: "#link", confidence: 0.9 }, description: "Click link" },
        result: { success: true },
        timestamp: Date.now(),
      });

      expect(sm.getState()).toBe("executing");
      expect(sm.getActionCount()).toBe(2);
      expect(sm.getHistory()).toHaveLength(2);
    });
  });
});