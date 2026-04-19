# Task 1.4: Content Script - Action Executor
## Technical Execution Plan

**Status**: Ready for implementation
**Priority**: High
**Estimated Effort**: 2 days

---

## Executive Summary

Implement the missing content-script action execution layer for the Chrome extension. The current system can:

- observe the page (`content/dom-observer.ts`)
- preview a planned step (`content/preview.ts`)
- orchestrate step confirmation in the service worker (`background/service-worker.ts`, `background/message-handlers.ts`)

It cannot yet execute the step after confirmation. This task adds a dedicated action executor content script module, explicit request/result messages, action validation, and structured execution logging so the service worker can advance the plan based on real browser outcomes instead of placeholder behavior.

---

## Current State Analysis

### What already exists

- `content/preview.ts` highlights a target element and returns `ELEMENT_SNAPSHOT`
- `content/dom-observer.ts` extracts DOM snapshots and mutation events
- `background/service-worker.ts` and `background/message-handlers.ts` manage preview-state progression
- `shared/messages.ts` defines preview and observation messages

### Current gap

`confirmCurrentStep()` in both service worker implementations clears the overlay and immediately advances to the next step. No message contract exists for "execute this action" or "here is the result of that execution."

### Implication

Without an execution boundary:

- step success is assumed instead of verified
- failures cannot be surfaced to the popup or planner
- navigation and DOM-change timing cannot be managed safely
- auditability is limited to console logs

---

## Proposed Architecture

### Components

```
┌──────────────────────────┐
│ Popup                    │
│ confirm / skip / status  │
└────────────┬─────────────┘
             │ STEP_CONFIRM
             ▼
┌──────────────────────────┐
│ Service Worker           │
│ execution coordinator    │
│ owns preview state       │
└────────────┬─────────────┘
             │ EXECUTE_ACTION
             ▼
┌──────────────────────────┐
│ Content Script           │
│ action-executor.ts       │
│ validate + execute       │
└────────────┬─────────────┘
             │ ACTION_RESULT
             ▼
┌──────────────────────────┐
│ Service Worker           │
│ update state / advance   │
│ notify popup / log       │
└──────────────────────────┘
```

### File boundaries

- `shared/messages.ts`
  Add action execution request/result message types and shared payloads.
- `content/action-executor.ts`
  New module that executes validated DOM actions.
- `background/message-handlers.ts`
  Replace placeholder execution with message-driven action execution.
- `background/service-worker.ts`
  Mirror the same execution flow if this file remains the manifest entrypoint.
- `background/message-validator.ts`
  Validate the new request/result schemas.
- `manifest.json`
  Load `content/action-executor.js` before or alongside other content scripts.

---

## Message Contract

### New messages

```ts
type ActionType = "click" | "type" | "select" | "navigate";

interface ExecuteActionMessage {
  type: "EXECUTE_ACTION";
  payload: {
    stepId: string;
    selector?: string;
    action: ActionType;
    value?: string;
    url?: string;
    expectedUrl?: string;
    timeoutMs?: number;
  };
}

interface ActionResultMessage {
  type: "ACTION_RESULT";
  payload: {
    stepId: string;
    action: ActionType;
    status: "success" | "failed";
    errorCode?: string;
    errorMessage?: string;
    urlBefore: string;
    urlAfter: string;
    timestamp: number;
    durationMs: number;
    target?: {
      selector?: string;
      tagName?: string;
      text?: string;
    };
  };
}
```

### Ownership rules

- Service worker sends `EXECUTE_ACTION`
- Content script never mutates workflow state directly
- Content script always emits exactly one `ACTION_RESULT`
- Service worker decides whether to advance, retry later, or halt

---

## Execution Flow

### Sequence diagram

```
Popup              Service Worker         Content Script
  | STEP_CONFIRM         |                      |
  |--------------------->|                      |
  |                      | CLEAR_PREVIEW        |
  |                      |--------------------->|
  |                      | EXECUTE_ACTION       |
  |                      |--------------------->|
  |                      |                      | validate payload
  |                      |                      | locate target
  |                      |                      | run DOM action
  |                      |                      | wait for stable outcome
  |                      | ACTION_RESULT        |
  |                      |<---------------------|
  | PREVIEW_STEP / DONE  |                      |
  |<---------------------|                      |
```

### Service worker state transitions

```
idle
  -> previewing
  -> awaiting_confirm
  -> executing
     -> previewing        next step success
     -> done              last step success
     -> awaiting_confirm  retryable failure after re-preview
     -> blocked terminal  unrecoverable failure surfaced to popup/log
```

### Action executor lifecycle

1. Validate message shape and action type.
2. Resolve target:
   - `navigate` uses `url` and does not require a selector.
   - all other actions require a selector.
3. Validate target existence and interactability.
4. Execute DOM action.
5. Wait for immediate post-condition:
   - `click`: dispatch click and wait one task/microtask turn plus optional navigation signal
   - `type`: focus, set value, dispatch `input` and `change`
   - `select`: set option, dispatch `input` and `change`
   - `navigate`: set `window.location.href`
6. Send `ACTION_RESULT` with timing and outcome data.

---

## Action Semantics

### `click`

Validation:

- selector resolves to an element
- element is connected to the document
- element is not disabled
- element is visible enough to be actionable

Execution:

- scroll into view if needed
- prefer `HTMLElement.click()` for native behavior
- if target is non-HTMLElement but event-capable, dispatch pointer/mouse/click events

Failure codes:

- `selector_invalid`
- `element_not_found`
- `element_not_connected`
- `element_not_interactable`

### `type`

Validation:

- selector resolves to `input`, `textarea`, or `[contenteditable="true"]`
- field is not disabled or readonly
- `value` is provided

Execution:

- focus target
- for text controls, set native value via property setter when applicable
- dispatch `input`
- dispatch `change` on blur or immediate completion

Failure codes:

- `value_required`
- `field_not_editable`
- `unsupported_target`

### `select`

Validation:

- selector resolves to `HTMLSelectElement`
- `value` is provided
- matching option exists by value or visible label

Execution:

- set selected option
- dispatch `input`
- dispatch `change`

Failure codes:

- `value_required`
- `unsupported_target`
- `option_not_found`

### `navigate`

Validation:

- `url` is provided
- URL parses successfully
- protocol is `http:` or `https:`

Execution:

- capture `urlBefore`
- update `window.location.href`
- send success result immediately before unload if possible; otherwise rely on service worker timeout fallback

Failure codes:

- `url_required`
- `url_invalid`
- `protocol_not_allowed`

---

## Trust Boundaries and Validation

### Trust model

- Popup input is untrusted workflow input.
- Service worker is the orchestration boundary.
- Content script runs in the page context and must treat selectors/values as untrusted data.

### Required validation

- reject selectors longer than a sane cap
- catch `querySelector` exceptions
- reject navigation to non-http(s) URLs
- never execute arbitrary script strings
- avoid `innerHTML` writes
- cap logged target text length

### Interactability checks

Common helper: `isInteractable(element)`

- connected to DOM
- computed style not `display:none` or `visibility:hidden`
- bounding box has positive size
- not `disabled`
- not `aria-hidden="true"` for actionable controls

---

## Failure Modes

| Scenario | Detection | Service worker behavior |
|---|---|---|
| Invalid selector syntax | selector parse throws | mark step failed, notify popup |
| Element disappears after preview | re-query misses | fail current step, do not auto-advance |
| Hidden or disabled element | interactability check | fail current step |
| Navigation unload interrupts response | missing `ACTION_RESULT` within timeout | treat as indeterminate, re-check tab URL before retry |
| Content script missing in tab | `chrome.tabs.sendMessage` rejects | fail execution and surface extension/runtime issue |
| Popup closed mid-run | runtime send to popup no-op | continue execution; popup is not authoritative |

---

## Logging and Auditability

### Logging model

Add a small structured logger helper in the action executor:

```ts
logActionEvent({
  stepId,
  phase: "validate" | "execute" | "result",
  action,
  status,
  metadata
});
```

### Required fields

- `stepId`
- `action`
- `selector` or `url`
- `timestamp`
- `durationMs`
- `status`
- `errorCode`

### Rules

- log to console in MVP
- keep payloads serializable
- do not log full field values for sensitive inputs later; for now, support redaction hook in helper signature

---

## Testing Plan

### Unit tests

Target files:

- new `content/action-executor.ts` helpers
- `background/message-validator.ts`
- `background/message-handlers.ts`

Cases:

- validates each new message type
- click succeeds on visible button
- click fails on disabled button
- type succeeds on input and textarea
- type fails without value
- select succeeds by option value
- select fails when option missing
- navigate rejects `javascript:` URL
- executor emits exactly one `ACTION_RESULT` per request

### Integration tests

Scenarios:

- service worker receives `STEP_CONFIRM` and emits `EXECUTE_ACTION`
- successful `ACTION_RESULT` advances to the next step
- failed `ACTION_RESULT` keeps workflow from falsely completing
- content script missing returns a controlled failure path

### Manual verification

1. Load unpacked extension.
2. Start a goal that previews a clickable element.
3. Confirm and verify the click actually changes the page.
4. Run a typing step and confirm DOM value plus `input/change` behavior.
5. Run a select step on a real `<select>`.
6. Run a navigation step and verify the service worker handles the tab transition without silently advancing on failure.

---

## Implementation Order

1. Extend `shared/messages.ts` with action execution contracts.
2. Add validator coverage for the new messages.
3. Create `content/action-executor.ts` with action helpers and result reporting.
4. Register the new content script in `manifest.json`.
5. Replace placeholder logic in `confirmCurrentStep()` with request/result execution handling.
6. Add tests for validators, executor helpers, and worker flow.

---

## Handoff Recommendation

Implementation should be assigned to an engineer as a single focused slice because the write set is tightly coupled:

- `packages/extension/shared/messages.ts`
- `packages/extension/content/action-executor.ts`
- `packages/extension/background/message-handlers.ts`
- `packages/extension/background/service-worker.ts`
- `packages/extension/background/message-validator.ts`
- extension tests

Review should go to the **Staff Engineer** once the branch is ready. QA should verify the manual matrix above before release.
