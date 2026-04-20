# BrowserAutoDrive — Phase 2 Product Plan
## Core Automation: The Magic Moment

**Goal:** User types a natural language goal, agent executes it end-to-end on the current tab.

---

## What Success Looks Like

> User: "Find the cheapest flight to Tokyo next week"
> Agent: Clicks search box → types query → hits enter → scans results → reports back

This is the **10-star moment** — browser on autopilot.

---

## Phase 2 Scope (Hold Scope)

| In Scope | Out of Scope (Phase 3) |
|----------|----------------------|
| Single-tab automation | Multi-tab workflows |
| Basic actions (click, type, scroll) | Complex form filling with validation |
| GLM-5 integration (primary) | Provider switching UI |
| Simple goal → plan → execute | Error recovery / retry loops |
| Visual preview before action | Human-in-the-loop confirmation for sensitive actions |

---

## Workstreams

### 1. Agent Loop in Service Worker

**What:** Port the OODA loop to run in the service worker.

**User value:** The brain runs continuously even when popup closes.

**Key behaviors:**
- Observe: Request DOM snapshot from content script
- Orient: Parse snapshot through LLM to understand state
- Decide: Generate next action based on goal + current state
- Act: Send action command to content script

**Success metric:** Loop completes 5+ iterations without crashing.

---

### 2. LLM Integration

**What:** Connect GLM-5 API to the extension.

**User value:** AI actually understands the page and makes decisions.

**Key behaviors:**
- API key stored in chrome.storage.local (encrypted)
- Prompt engineering for browser automation
- Structured output: `{ action: "click", selector: "...", reasoning: "..." }`
- Error handling for rate limits / auth failures

**Success metric:** 90%+ of actions are correctly chosen from page context.

---

### 3. Action Execution in Content Script

**What:** Content script receives commands and executes them on the DOM.

**User value:** Agent actually does things, not just observes.

**Key behaviors:**
- `EXECUTE_ACTION` message type
- Action types: `click`, `type`, `scroll`, `wait`, `navigate`
- Validation: Element exists before acting
- Visual feedback: Highlight element during execution
- Safety: Never execute on password fields without explicit opt-in

**Success metric:** 95%+ of actions execute without JavaScript errors.

---

### 4. Goal Input UI Polish

**What:** Popup provides clean goal input and status display.

**User value:** Clear understanding of what agent is doing.

**Key behaviors:**
- Textarea for multi-line goals
- Real-time step progress (Step 3 of 8)
- Cancel button to stop automation
- Error display with retry option

**Success metric:** User can start and monitor a run without confusion.

---

## Technical Handoff Notes for CTO

**Reuse from existing codebase:**
- `packages/core` — Agent Loop, GoalParser, Planner (ported)
- `packages/llm` — GLM-5 adapter (adapted for extension context)
- `packages/safety` — Safety gates (applied to action execution)

**New extension-specific work:**
- Service worker agent loop orchestration
- Message protocol between SW ↔ content script
- Action execution engine in content script
- LLM API key management in options page

**Critical decisions needed:**
1. GLM-5 vs OpenAI as default? (recommend GLM-5 for cost)
2. How to handle long-running runs when service worker sleeps?
3. Rate limiting strategy for LLM calls?

---

## Definition of Done

- [ ] User can type a goal in popup
- [ ] Agent generates plan via LLM
- [ ] Agent executes actions on current tab
- [ ] Visual feedback shows progress
- [ ] Cancel button works
- [ ] Error states handled gracefully

---

## Success Demo Script

1. Navigate to google.com
2. Open extension popup
3. Type: "Search for browser automation tools"
4. Click Start
5. Watch: Agent clicks search box → types query → presses enter
6. Result: Search results page loaded

This is the Phase 2 victory condition.

---

*Plan written by CEO. Ready for CTO technical specification.*
