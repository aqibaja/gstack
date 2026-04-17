# BrowserAutoDrive — Chrome Extension Product Plan

## Vision
"Your Browser. Fully On Autopilot."
AI-powered Chrome Extension that lets users automate any browser task using natural language.

## What Exists (Keep)
- `packages/core` — Agent Loop (OODA), GoalParser, Planner, SessionMemory, State Machine
- `packages/llm` — GLM-5 and OpenAI adapters
- `packages/safety` — Safety gates and guardrails
- `packages/observe` — Page observation logic (adapt for DOM access instead of Playwright)

## What Needs Building

### Phase 1: Extension Skeleton (MVP)
- **Manifest V3** extension with popup UI
- Content scripts for DOM observation and interaction
- Background service worker for agent loop orchestration
- Chrome storage for session persistence
- Replace Playwright browser control with `chrome.scripting.executeScript` and direct DOM manipulation

### Phase 2: Core Automation
- Port agent loop to run in background service worker
- Connect LLM adapters to extension (API key management via options page)
- Content script bridge: observe page → extract interactive elements → execute actions
- Multi-tab support via `chrome.tabs` API
- Goal input UI in popup or sidebar panel

### Phase 3: Product Polish
- Action confirmation UI (human-in-the-loop for high-stakes actions)
- Session history and replay
- Keyboard shortcut to trigger automation on current tab
- Options page for LLM provider configuration

## Architecture

```
browserautodrive/
├── packages/
│   ├── core/          # Shared (keep as-is)
│   ├── llm/           # Shared (keep as-is)
│   ├── safety/        # Shared (keep as-is)
│   ├── observe/       # Adapt: DOM-based observation
│   ├── extension/     # NEW: Chrome Extension
│   │   ├── manifest.json
│   │   ├── popup/     # UI: goal input, status display
│   │   ├── background/# Service worker: agent loop
│   │   ├── content/   # Content scripts: page interaction
│   │   └── options/   # Settings: API keys, provider config
│   └── cli/           # Keep as developer tool (secondary)
```

## Key Decisions
1. **Extension is primary product** — CLI is secondary developer tool
2. **Reuse core engine** — Agent loop, planner, parser all work; just need new browser adapter
3. **DOM-first observation** — Instead of Playwright screenshots, use DOM tree + accessibility tree from content scripts
4. **Service worker for agent** — Background service worker runs the OODA loop, communicates with content scripts via message passing

## Success Criteria
- User installs extension → types natural language goal → agent executes on current tab
- Works on any website without server infrastructure
- Human-in-the-loop for sensitive actions (payments, form submissions)
- Multi-tab automation for complex workflows

## Handoff
This plan goes to the **CTO** for technical execution specification.
