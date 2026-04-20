// BrowserAutoDrive — LLM Bridge for Extension
// Reads API key from chrome.storage, wraps GLM-5/OpenAI adapters with rate limiting and recovery.

import type { AgentDecision, PromptContext } from "@browserautodrive/core";
import { GLM5Adapter, OpenAICompatAdapter, ProviderFactory, LLMConfig } from "@browserautodrive/llm";

export type LLMProviderType = "glm5" | "openai";

export interface LLMBridgeConfig {
  providerType: LLMProviderType;
  maxRetries?: number;
  baseDelayMs?: number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const STORAGE_KEY_PROVIDER = "bad.llm.provider";
const STORAGE_KEY_API_KEY = "bad.llm.apiKey";
const STORAGE_KEY_BASE_URL = "bad.llm.baseUrl";
const STORAGE_KEY_MODEL = "bad.llm.model";

interface StoredLLMConfig {
  provider: LLMProviderType;
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

let cachedProvider: { type: LLMProviderType; instance: GLM5Adapter | OpenAICompatAdapter } | null = null;

async function loadStoredConfig(): Promise<StoredLLMConfig | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [STORAGE_KEY_PROVIDER, STORAGE_KEY_API_KEY, STORAGE_KEY_BASE_URL, STORAGE_KEY_MODEL],
      (result) => {
        if (!result[STORAGE_KEY_API_KEY]) {
          resolve(null);
          return;
        }
        resolve({
          provider: result[STORAGE_KEY_PROVIDER] || "glm5",
          apiKey: result[STORAGE_KEY_API_KEY],
          baseUrl: result[STORAGE_KEY_BASE_URL],
          model: result[STORAGE_KEY_MODEL],
        });
      }
    );
  });
}

async function saveStoredConfig(config: StoredLLMConfig): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [STORAGE_KEY_PROVIDER]: config.provider,
        [STORAGE_KEY_API_KEY]: config.apiKey,
        ...(config.baseUrl && { [STORAGE_KEY_BASE_URL]: config.baseUrl }),
        ...(config.model && { [STORAGE_KEY_MODEL]: config.model }),
      },
      () => resolve()
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LLMBridge {
  private maxRetries: number;
  private baseDelayMs: number;

  constructor(config?: LLMBridgeConfig) {
    this.maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = config?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  }

  async getProvider(): Promise<GLM5Adapter | OpenAICompatAdapter | null> {
    if (cachedProvider) return cachedProvider.instance;

    const stored = await loadStoredConfig();
    if (!stored) return null;

    const llmConfig: LLMConfig = {
      apiKey: stored.apiKey,
      ...(stored.baseUrl && { baseUrl: stored.baseUrl }),
      ...(stored.model && { model: stored.model }),
    };

    const instance = ProviderFactory.create(stored.provider, llmConfig) as GLM5Adapter | OpenAICompatAdapter;
    cachedProvider = { type: stored.provider, instance };
    return instance;
  }

  async configure(config: { provider: LLMProviderType; apiKey: string; baseUrl?: string; model?: string }): Promise<void> {
    cachedProvider = null;
    await saveStoredConfig(config);
  }

  async validateApiKey(): Promise<boolean> {
    const provider = await this.getProvider();
    if (!provider) return false;
    return provider.validateApiKey();
  }

  async isConfigured(): Promise<boolean> {
    const stored = await loadStoredConfig();
    return stored !== null && stored.apiKey.length > 0;
  }

  async complete(prompt: PromptContext): Promise<AgentDecision> {
    const provider = await this.getProvider();
    if (!provider) {
      throw new Error("LLM provider not configured. Set API key in options page.");
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await provider.complete(prompt);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.maxRetries) {
          const delay = this.baseDelayMs * Math.pow(2, attempt);
          console.warn(`[BAD][llm-bridge] LLM call failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${delay}ms: ${lastError.message}`);
          await sleep(delay);
        }
      }
    }

    throw new Error(`LLM call failed after ${this.maxRetries + 1} attempts: ${lastError?.message}`);
  }

  resetCache(): void {
    cachedProvider = null;
  }
}

export const llmBridge = new LLMBridge();
