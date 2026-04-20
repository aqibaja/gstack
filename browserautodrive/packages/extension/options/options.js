// BrowserAutoDrive — Options Page Script
// Manages LLM provider configuration and tier settings.

const STORAGE_KEY_PROVIDER = "bad.llm.provider";
const STORAGE_KEY_API_KEY = "bad.llm.apiKey";
const STORAGE_KEY_BASE_URL = "bad.llm.baseUrl";
const STORAGE_KEY_MODEL = "bad.llm.model";
const STORAGE_KEY_TIER = "tier";
const STORAGE_KEY_AUTO_EXECUTE = "autoExecute";

async function loadSettings(): Promise<void> {
  const result = await chrome.storage.local.get([
    STORAGE_KEY_PROVIDER,
    STORAGE_KEY_API_KEY,
    STORAGE_KEY_BASE_URL,
    STORAGE_KEY_MODEL,
    STORAGE_KEY_TIER,
    STORAGE_KEY_AUTO_EXECUTE,
  ]);

  (document.getElementById("provider") as HTMLSelectElement).value = result[STORAGE_KEY_PROVIDER] || "glm5";
  (document.getElementById("apiKey") as HTMLInputElement).value = result[STORAGE_KEY_API_KEY] || "";
  (document.getElementById("baseUrl") as HTMLInputElement).value = result[STORAGE_KEY_BASE_URL] || "";
  (document.getElementById("model") as HTMLInputElement).value = result[STORAGE_KEY_MODEL] || "";
  (document.getElementById("tier") as HTMLSelectElement).value = result[STORAGE_KEY_TIER] || "free";
  (document.getElementById("autoExecute") as HTMLInputElement).checked = result[STORAGE_KEY_AUTO_EXECUTE] || false;
}

async function saveSettings(): Promise<void> {
  const provider = (document.getElementById("provider") as HTMLSelectElement).value;
  const apiKey = (document.getElementById("apiKey") as HTMLInputElement).value.trim();
  const baseUrl = (document.getElementById("baseUrl") as HTMLInputElement).value.trim();
  const model = (document.getElementById("model") as HTMLInputElement).value.trim();
  const tier = (document.getElementById("tier") as HTMLSelectElement).value;
  const autoExecute = (document.getElementById("autoExecute") as HTMLInputElement).checked;

  if (!apiKey) {
    showStatus("API key is required", "error");
    return;
  }

  await chrome.storage.local.set({
    [STORAGE_KEY_PROVIDER]: provider,
    [STORAGE_KEY_API_KEY]: apiKey,
    ...(baseUrl && { [STORAGE_KEY_BASE_URL]: baseUrl }),
    ...(model && { [STORAGE_KEY_MODEL]: model }),
    [STORAGE_KEY_TIER]: tier,
    [STORAGE_KEY_AUTO_EXECUTE]: tier === "pro" && autoExecute,
  });

  showStatus("Settings saved successfully", "success");
}

async function testConnection(): Promise<void> {
  const apiKey = (document.getElementById("apiKey") as HTMLInputElement).value.trim();
  if (!apiKey) {
    showStatus("Enter an API key first", "error");
    return;
  }

  showStatus("Testing connection...", "success");

  try {
    const provider = (document.getElementById("provider") as HTMLSelectElement).value;
    const baseUrl = (document.getElementById("baseUrl") as HTMLInputElement).value.trim();

    const testUrl = provider === "glm5"
      ? (baseUrl || "https://open.bigmodel.cn/api/paas/v4") + "/models"
      : (baseUrl || "https://api.openai.com/v1") + "/models";

    const response = await fetch(testUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (response.ok) {
      showStatus("Connection successful!", "success");
    } else {
      const errorText = await response.text();
      showStatus(`Connection failed: ${response.status} - ${errorText.slice(0, 100)}`, "error");
    }
  } catch (error) {
    showStatus(`Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
  }
}

function showStatus(message: string, type: "success" | "error"): void {
  const statusEl = document.getElementById("status");
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

document.addEventListener("DOMContentLoaded", () => {
  void loadSettings();

  document.getElementById("save")?.addEventListener("click", () => {
    void saveSettings();
  });

  document.getElementById("test")?.addEventListener("click", () => {
    void testConnection();
  });

  document.getElementById("toggleKey")?.addEventListener("click", () => {
    const input = document.getElementById("apiKey") as HTMLInputElement;
    const btn = document.getElementById("toggleKey") as HTMLButtonElement;
    if (input.type === "password") {
      input.type = "text";
      btn.textContent = "Hide";
    } else {
      input.type = "password";
      btn.textContent = "Show";
    }
  });

  document.getElementById("tier")?.addEventListener("change", () => {
    const tier = (document.getElementById("tier") as HTMLSelectElement).value;
    const autoExecuteCheckbox = document.getElementById("autoExecute") as HTMLInputElement;
    if (tier !== "pro") {
      autoExecuteCheckbox.checked = false;
      autoExecuteCheckbox.disabled = true;
    } else {
      autoExecuteCheckbox.disabled = false;
    }
  });
});
