// BrowserAutoDrive — LLM Provider Adapters

import { AgentDecision, PromptContext } from "@browserautodrive/core";

export interface LLMProvider {
  complete(prompt: PromptContext): Promise<AgentDecision>;
  validateApiKey(): Promise<boolean>;
}

export interface LLMConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0;

export class GLM5Adapter implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(config: LLMConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://open.bigmodel.cn/api/paas/v4";
    this.model = config.model ?? "glm-5-plus";
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;
  }

  async complete(prompt: PromptContext): Promise<AgentDecision> {
    const systemMessage = this.buildSystemPrompt(prompt);
    const userMessage = this.buildUserPrompt(prompt);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: userMessage },
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `GLM-5 API error (${response.status}): ${errorBody}`
      );
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("GLM-5 API returned empty response");
    }

    return this.parseDecision(content);
  }

  async validateApiKey(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private buildSystemPrompt(context: PromptContext): string {
    return `You are BrowserAutoDrive, an AI agent that controls web browsers autonomously.

Your goal: ${context.goal.objective}
Success criteria: ${context.goal.successCriteria}

You must respond with a JSON object containing your next action decision:
{
  "action": { "type": "<action_type>", ...action fields },
  "reasoning": "Why you chose this action",
  "confidence": 0.0-1.0
}

Available action types:
- navigate: { "type": "navigate", "url": "..." }
- click: { "type": "click", "target": { "selector": "...", "text": "...", "role": "...", "confidence": 0.0-1.0 }, "description": "..." }
- type: { "type": "type", "target": { "selector": "...", "confidence": 0.0-1.0 }, "text": "...", "description": "..." }
- scroll: { "type": "scroll", "direction": "up|down", "amount": 500 }
- select: { "type": "select", "target": { "selector": "...", "confidence": 0.0-1.0 }, "value": "...", "description": "..." }
- extract: { "type": "extract", "description": "what to extract", "dataType": "text|data" }
- wait: { "type": "wait", "durationMs": 1000, "reason": "..." }
- ask_human: { "type": "ask_human", "question": "...", "options": ["..."] }
- done: { "type": "done", "result": "...", "success": true|false }

IMPORTANT: If you are unsure or confidence is below 0.5, use ask_human.
If the goal is complete, use done.
Never fabricate selectors. Only use selectors from the provided page state.`;
  }

  private buildUserPrompt(context: PromptContext): string {
    const recentHistory = context.history.slice(-5).map((h) => ({
      step: h.step,
      action: h.action,
      result: h.result.success ? "success" : `failed: ${h.result.error}`,
    }));

    const interactiveElements = context.observation.interactiveElements
      .slice(0, 30)
      .map((el) => `${el.role}: "${el.text}" [${el.selector}] (confidence: ${el.confidence})`)
      .join("\n");

    return `Current step ${context.stepIndex + 1} of estimated ${context.plan.estimatedActions} actions.

Page state:
URL: ${context.observation.url}
Title: ${context.observation.title}

Interactive elements:
${interactiveElements || "None found"}

Previous actions (last 5):
${JSON.stringify(recentHistory, null, 2)}

Plan steps: ${context.plan.steps.join(" → ")}

What is your next action?`;
  }

  private parseDecision(content: string): AgentDecision {
    try {
      const parsed = JSON.parse(content);

      if (!parsed.action || !parsed.action.type) {
        throw new Error("Response missing action.type");
      }

      return {
        action: parsed.action,
        reasoning: parsed.reasoning ?? "",
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      };
    } catch (e) {
      throw new Error(
        `Failed to parse LLM decision: ${e instanceof Error ? e.message : "unknown error"}. Raw: ${content}`
      );
    }
  }
}

export class OpenAICompatAdapter implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(config: LLMConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
    this.model = config.model ?? "gpt-4o";
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;
  }

  async complete(prompt: PromptContext): Promise<AgentDecision> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content: this.buildSystemPrompt(prompt),
          },
          {
            role: "user",
            content: this.buildUserPrompt(prompt),
          },
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `OpenAI API error (${response.status}): ${errorBody}`
      );
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("OpenAI API returned empty response");
    }

    return this.parseDecision(content);
  }

  async validateApiKey(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private buildSystemPrompt(context: PromptContext): string {
    return `You are BrowserAutoDrive, an AI agent that controls web browsers autonomously.

Your goal: ${context.goal.objective}
Success criteria: ${context.goal.successCriteria}

Respond with a JSON object:
{
  "action": { "type": "<action_type>", ... },
  "reasoning": "why",
  "confidence": 0.0-1.0
}

Available actions: navigate, click, type, scroll, select, extract, wait, ask_human, done.`;
  }

  private buildUserPrompt(context: PromptContext): string {
    return `Current page: ${context.observation.url} - ${context.observation.title}
Step ${context.stepIndex + 1} of ~${context.plan.estimatedActions}
Interactive elements: ${context.observation.interactiveElements.slice(0, 20).map((e) => `${e.role}: ${e.text}`).join(", ")}
Previous actions: ${context.history.slice(-3).map((h) => `${h.action.type}`).join(" → ")}
What is your next action?`;
  }

  private parseDecision(content: string): AgentDecision {
    try {
      const parsed = JSON.parse(content);
      if (!parsed.action || !parsed.action.type) {
        throw new Error("Response missing action.type");
      }
      return {
        action: parsed.action,
        reasoning: parsed.reasoning ?? "",
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      };
    } catch (e) {
      throw new Error(
        `Failed to parse LLM decision: ${e instanceof Error ? e.message : "unknown error"}`
      );
    }
  }
}

export class ProviderFactory {
  static create(type: "glm5" | "openai", config: LLMConfig): LLMProvider {
    switch (type) {
      case "glm5":
        return new GLM5Adapter(config);
      case "openai":
        return new OpenAICompatAdapter(config);
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }
}