// BrowserAutoDrive — LLM Adapter Tests

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { GLM5Adapter, OpenAICompatAdapter, ProviderFactory, LLMConfig } from "../src/index";

// ─── Mock fetch ────────────────────────────────────────────────────────────────

const mockFetch = jest.fn<typeof globalThis.fetch>();
(globalThis as any).fetch = mockFetch;

function makePromptContext(): any {
  return {
    goal: { objective: "Search for cats", successCriteria: "Search results shown" },
    plan: { steps: ["navigate", "type", "submit"], estimatedActions: 3 },
    stepIndex: 0,
    observation: {
      url: "https://google.com",
      title: "Google",
      timestamp: Date.now(),
      accessibilityTree: [],
      interactiveElements: [
        { role: "textbox", text: "Search", selector: "#search", confidence: 0.95 },
      ],
      screenshot: "",
      viewportSize: { width: 1280, height: 720 },
      scrollPosition: { x: 0, y: 0 },
      formFields: [],
    },
    history: [],
    availableActions: ["navigate", "click", "type", "scroll", "done"],
  };
}

function makeDecisionResponse(overrides: object = {}): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ action: { type: "click", target: { selector: "#btn" } }, reasoning: "Click button", confidence: 0.9 }) } }],
      ...overrides,
    }),
    { status: 200 }
  );
}

function makeErrorResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

// ─── GLM-5 Adapter Tests ─────────────────────────────────────────────────────

describe("GLM5Adapter", () => {
  let config: LLMConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    config = { apiKey: "test-glm-key" };
  });

  describe("constructor", () => {
    it("uses defaults", () => {
      const adapter = new GLM5Adapter(config);
      expect(adapter).toBeDefined();
    });

    it("accepts custom baseUrl and model", () => {
      const adapter = new GLM5Adapter({
        ...config,
        baseUrl: "https://custom.api/v1",
        model: "glm-5-turbo",
      });
      expect(adapter).toBeDefined();
    });
  });

  describe("complete", () => {
    it("calls GLM-5 API with correct payload", async () => {
      mockFetch.mockResolvedValue(makeDecisionResponse());
      const adapter = new GLM5Adapter(config);
      const ctx = makePromptContext();

      const result = await adapter.complete(ctx);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-glm-key",
          }),
        })
      );

      const callBody = JSON.parse((mockFetch.mock.calls[0][1] as any).body as string);
      expect(callBody.model).toBe("glm-5-plus");
      expect(callBody.response_format).toEqual({ type: "json_object" });
      expect(result.action.type).toBe("click");
      expect(result.confidence).toBe(0.9);
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(401, "Invalid API key"));
      const adapter = new GLM5Adapter(config);

      await expect(adapter.complete(makePromptContext())).rejects.toThrow("GLM-5 API error (401)");
    });

    it("throws on empty response", async () => {
      mockFetch.mockResolvedValue(new Response(
        JSON.stringify({ choices: [{ message: { content: "" } }] }),
        { status: 200 }
      ));
      const adapter = new GLM5Adapter(config);

      await expect(adapter.complete(makePromptContext())).rejects.toThrow("GLM-5 API returned empty response");
    });

    it("throws on malformed JSON", async () => {
      mockFetch.mockResolvedValue(new Response(
        JSON.stringify({ choices: [{ message: { content: "not json" } }] }),
        { status: 200 }
      ));
      const adapter = new GLM5Adapter(config);

      await expect(adapter.complete(makePromptContext())).rejects.toThrow("Failed to parse LLM decision");
    });

    it("defaults confidence to 0.5 when missing", async () => {
      mockFetch.mockResolvedValue(makeDecisionResponse({
        choices: [{ message: { content: JSON.stringify({ action: { type: "done", result: "ok", success: true }, reasoning: "done" }) } }],
      }));
      const adapter = new GLM5Adapter(config);
      const result = await adapter.complete(makePromptContext());
      expect(result.confidence).toBe(0.5);
    });
  });

  describe("validateApiKey", () => {
    it("returns true for valid key", async () => {
      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
      const adapter = new GLM5Adapter(config);
      expect(await adapter.validateApiKey()).toBe(true);
    });

    it("returns false for invalid key", async () => {
      mockFetch.mockResolvedValue(new Response(null, { status: 401 }));
      const adapter = new GLM5Adapter(config);
      expect(await adapter.validateApiKey()).toBe(false);
    });

    it("returns false on network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      const adapter = new GLM5Adapter(config);
      expect(await adapter.validateApiKey()).toBe(false);
    });
  });
});

// ─── OpenAI Adapter Tests ────────────────────────────────────────────────────

describe("OpenAICompatAdapter", () => {
  let config: LLMConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    config = { apiKey: "test-openai-key" };
  });

  describe("complete", () => {
    it("calls OpenAI API with correct payload", async () => {
      mockFetch.mockResolvedValue(makeDecisionResponse());
      const adapter = new OpenAICompatAdapter(config);

      const result = await adapter.complete(makePromptContext());

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-openai-key",
          }),
        })
      );

      const callBody = JSON.parse((mockFetch.mock.calls[0][1] as any).body as string);
      expect(callBody.model).toBe("gpt-4o");
      expect(result.action.type).toBe("click");
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(429, "Rate limit exceeded"));
      const adapter = new OpenAICompatAdapter(config);

      await expect(adapter.complete(makePromptContext())).rejects.toThrow("OpenAI API error (429)");
    });
  });

  describe("validateApiKey", () => {
    it("returns true for valid key", async () => {
      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
      const adapter = new OpenAICompatAdapter(config);
      expect(await adapter.validateApiKey()).toBe(true);
    });

    it("returns false on network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      const adapter = new OpenAICompatAdapter(config);
      expect(await adapter.validateApiKey()).toBe(false);
    });
  });
});

// ─── ProviderFactory Tests ───────────────────────────────────────────────────

describe("ProviderFactory", () => {
  it("creates GLM-5 adapter", () => {
    const provider = ProviderFactory.create("glm5", { apiKey: "key" });
    expect(provider).toBeInstanceOf(GLM5Adapter);
  });

  it("creates OpenAI adapter", () => {
    const provider = ProviderFactory.create("openai", { apiKey: "key" });
    expect(provider).toBeInstanceOf(OpenAICompatAdapter);
  });

  it("throws on unknown provider", () => {
    expect(() => ProviderFactory.create("unknown" as any, { apiKey: "key" })).toThrow("Unknown provider type: unknown");
  });
});
