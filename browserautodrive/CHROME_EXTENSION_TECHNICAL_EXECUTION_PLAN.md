# BrowserAutoDrive Chrome Extension Technical Execution Plan

## Status

Locked for implementation.

This is the canonical CTO-level execution plan for the BrowserAutoDrive Chrome extension. It consolidates the product plan in `CHROME_EXTENSION_PLAN.md` with the detailed component plans under `packages/extension/`.

## Scope

Build a Manifest V3 Chrome extension that runs BrowserAutoDrive's agent loop against the active browser tab with:

- popup-driven goal entry
- service-worker-owned execution orchestration
- content-script DOM observation and action execution
- storage-backed recovery for MV3 worker suspension
- human-in-the-loop controls for sensitive or uncertain actions

## Non-Goals

- no backend service requirement for MVP execution
- no cross-browser support in the first release
- no autonomous high-risk action execution without an explicit policy gate

## Architecture

### Component Diagram

```text
+----------------------+          +---------------------------+
| Popup UI             |          | Options Page             |
| goal entry           |          | provider + API key setup |
| run status           |          | policy configuration     |
| confirmation         |          +-------------+------------+
+----------+-----------+                        |
           | runtime messaging                 | storage/runtime messaging
           v                                   v
+---------------------------------------------------------------+
| Background Service Worker                                      |
| - agent session coordinator                                    |
| - message router + validator                                   |
| - execution state machine                                      |
| - storage persistence + restore                                |
| - tab targeting + policy enforcement                           |
+--------------------+---------------------------+---------------+
                     |                           |
                     | tabs.sendMessage          | chrome.storage
                     v                           v
+---------------------------+       +------------------------------+
| Content Scripts           |       | chrome.storage.local/session |
| - DOM observer            |       | - provider config            |
| - preview overlay         |       | - resumable session snapshot |
| - action executor         |       | - user preferences           |
+---------------------------+       +------------------------------+
```

### Trust Boundaries

- Popup UI is trusted for user intent only. It is not authoritative for run state.
- Content scripts are trusted for tab-local observation and execution results only.
- Service worker is the sole authority for session state, progression, retries, and policy.
- LLM provider credentials live in extension storage and must only be read by the options page and service worker.
- All runtime messages are treated as untrusted until validated by schema, sender context, `sessionId`, and `stepId`.

## Manifest and Permission Decisions

Keep the manifest minimal and explicit.

```text
Required:
- activeTab
- storage
- scripting

Likely required as implementation lands:
- tabs
- alarms
```

Rules:

- `activeTab` gates tab-scoped execution to user-initiated contexts.
- `storage` persists configuration, tier flags, and resumable session snapshots.
- `scripting` is reserved for targeted injection or future dynamic registration; avoid broad use when static content scripts are sufficient.
- `tabs` is required once multi-tab orchestration becomes real, not before.
- `alarms` is preferred over raw timers for delayed recovery work when MV3 suspension becomes a correctness risk.
- Keep host access at `"<all_urls>"` only while the product promise remains "works on any website"; if enterprise scoping appears later, host permissions should be narrowed by deployment profile.

## Canonical Data Flow

### Goal Start

```text
Popup -> Service Worker: START_GOAL
Service Worker:
  validate active tab + provider config + tier policy
  create session
  persist resumable snapshot
  request page snapshot / preview
Content Script -> Service Worker: SNAPSHOT_RESPONSE / ELEMENT_SNAPSHOT
Service Worker:
  derive current step state
  push normalized popup state
```

### Step Confirmation and Execution

```text
Popup -> Service Worker: STEP_CONFIRM
Service Worker:
  validate sessionId + stepId + current status
  clear preview
  send EXECUTE_ACTION
Content Script -> Service Worker: ACTION_RESULT
Service Worker:
  advance reducer
  retry / fail / proceed / complete
  persist snapshot
  notify popup
```

### Recovery

```text
Popup opens -> POPUP_READY
Service Worker:
  restore durable session from storage
  rebuild ephemeral timers/subscriptions
  emit authoritative POPUP_STATE
```

## Message Contract

All messages must move into a single shared contract under `packages/extension/shared/messages.ts`.

### Popup to Service Worker

- `POPUP_READY`
- `START_GOAL`
- `STEP_CONFIRM`
- `STEP_SKIP`
- `STEP_SKIP_ALL`
- `USER_INTERVENED`

### Service Worker to Popup

- `POPUP_STATE`
- `POPUP_ERROR`
- `TIER_CONFIG`

### Service Worker to Content Script

- `GET_SNAPSHOT`
- `START_OBSERVING`
- `STOP_OBSERVING`
- `PREVIEW_STEP`
- `CLEAR_PREVIEW`
- `EXECUTE_ACTION`

### Content Script to Service Worker

- `SNAPSHOT_RESPONSE`
- `PAGE_MUTATED`
- `ELEMENT_SNAPSHOT`
- `ACTION_RESULT`

### Contract Rules

- Every execution-bound message carries `sessionId`.
- Every step-bound message carries `stepId`.
- Reducer-relevant messages include a stable `timestamp`.
- Unknown, stale, or context-invalid messages are logged and dropped.
- Popup reconnection must be pull-first via `POPUP_READY`, not push-only.

## State Model

### Durable Session State

Persist enough state to recover after service worker suspension:

- `sessionId`
- `goal`
- `tabId`
- `status`
- `steps`
- `currentStepIndex`
- `currentStepId`
- `currentStepAttempt`
- `tier`
- `autoExecute`
- `autoExecuteDelayMs`
- `pendingNavigation`
- `failure`
- `updatedAt`

### Ephemeral Runtime State

Do not persist:

- timer handles
- transient request promises
- popup connection presence
- debug subscribers

These must be reconstructed from durable state on restore.

## Execution State Machine

```text
idle
  -> preparing_step
  -> cancelled

preparing_step
  -> previewing_step
  -> failed
  -> cancelled

previewing_step
  -> awaiting_decision
  -> failed
  -> cancelled

awaiting_decision
  -> executing_step
  -> preparing_step
  -> cancelled
  -> failed

executing_step
  -> preparing_step
  -> waiting_for_navigation
  -> completed
  -> awaiting_decision
  -> failed
  -> cancelled

waiting_for_navigation
  -> preparing_step
  -> completed
  -> awaiting_decision
  -> failed
  -> cancelled
```

Transition rules:

- only the service worker reducer may change session status
- content scripts report facts, never progression decisions
- popup commands are accepted only when they match the active `sessionId` and `stepId`
- retries re-enter preview/decision, not silent execution

## Failure Modes and Policy

| Failure | Policy |
|---|---|
| No active tab | reject `START_GOAL`, show terminal popup error |
| Provider/API key missing | reject run start, route user to options page |
| Content script not available | retry targeted injection if allowed, otherwise recoverable error |
| Stale popup command | ignore and return fresh `POPUP_STATE` |
| Target element missing | retryable failure if DOM changed, otherwise step-level terminal failure |
| Navigation after action | move to `waiting_for_navigation`, rehydrate after settle |
| Worker suspended mid-run | restore from storage, rebuild timers, never auto-advance silently |
| Popup closes | no workflow impact; popup is best-effort only |
| Non-retryable action failure | mark session `failed`, preserve diagnostics |
| User intervention | cancel auto-execute, require fresh decision |

## Human-in-the-Loop Policy

The MVP must default toward safety over throughput.

- Free tier always requires explicit confirmation.
- Pro tier may enable auto-execute only for low-risk actions and only while no intervention has occurred.
- Sensitive actions must force confirmation regardless of tier:
  - payments
  - final form submits
  - destructive settings/account changes
  - actions with ambiguous target resolution
- If target confidence is below threshold, revert to preview + confirm.

## Build and Packaging Plan

### Current State

- extension package currently builds with `tsc` plus a static file copy script
- popup is still plain HTML/CSS/TS

### Locked Build Direction

- keep background/content on TypeScript compilation initially
- move popup to Vite + React + CSS Modules
- emit final extension artifact into `packages/extension/dist`
- manifest references compiled popup assets and the chosen service worker entrypoint

### Build Stages

1. compile TypeScript for background/content/shared
2. bundle popup separately
3. copy manifest and static CSS/assets
4. validate manifest paths against `dist/`
5. package zip artifact for Chrome load/unpacked or release handoff

## Test Strategy

### Unit

- message validator accepts only supported schemas
- reducer rejects stale `sessionId` and `stepId`
- popup view-model normalization is deterministic
- action executor validates interactability rules correctly

### Integration

- popup start-goal flow reaches preview state
- popup reopen hydrates current worker state
- confirm/skip commands are idempotent
- action result success advances to next step
- recoverable failure returns to preview/decision
- storage restore rebuilds active session after worker restart

### End-to-End

- user enters a goal, preview appears, confirm executes, run completes
- DOM mutation between preview and confirm is handled safely
- navigation-producing action resumes correctly after page load
- provider missing path routes user to options without corrupting state
- popup closed during run does not terminate execution

### Manual QA Focus

- host page variance across forms, buttons, links, and SPAs
- permission prompts and extension reload behavior
- long selector/reasoning strings in popup layout
- tier-policy differences between free and pro

## Ordered Execution Plan

The board direction is sequential execution, one active implementation task at a time.

1. `GST-22` Build Pipeline Setup
2. `GST-23` Popup UI Foundation
3. `GST-33` Content Script - DOM Observer
4. `GST-25` Content Script - Action Executor
5. `GST-34` Service Worker - Message Router
6. `GST-31` Service Worker - State Machine
7. `GST-24` Agent Loop Integration
8. `GST-26` LLM Adapter - Browser Bridge
9. `GST-35` Options Page - API Key Management
10. `GST-36` Multi-Tab Support
11. `GST-28` Page Snapshot -> LLM Pipeline
12. `GST-30` Human-in-the-Loop UI
13. `GST-29` Session History and Replay
14. `GST-27` Keyboard Shortcuts
15. `GST-32` Extension Icons and Branding

## Ownership and Handoff

- CTO owns architecture, sequencing, and acceptance criteria.
- Staff Engineer owns implementation on the active task and routes ready branches back for review.
- QA Engineer validates the test matrix once a task reaches review.
- Release Engineer owns packaging and release workflow once the extension build is stable.

Implementation handoff rule:

- do not start the next item until the current item is truly `done` or explicitly waived
- route any implementation branch ready for technical review to the Staff Engineer
- route release-readiness work to the Release Engineer only after build/package acceptance criteria are met

## Acceptance Criteria for GST-15

`GST-15` is complete when:

- a canonical end-to-end technical plan exists
- architecture and trust boundaries are explicit
- state transitions and message ownership are locked
- failure modes and test coverage are specified
- ordered implementation handoff is unambiguous

This document satisfies that scope.

## Supporting Detailed Plans

- `CHROME_EXTENSION_PLAN.md`
- `packages/extension/popup/POPUP_UI_FOUNDATION_PLAN.md`
- `packages/extension/content/ACTION_EXECUTOR_PLAN.md`
- `packages/extension/background/MESSAGE_ROUTER_PLAN.md`
- `packages/extension/background/STATE_MACHINE_PLAN.md`
