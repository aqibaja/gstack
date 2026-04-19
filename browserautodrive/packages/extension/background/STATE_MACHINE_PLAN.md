# Task 1.6: Service Worker — State Machine
## Technical Execution Plan

**Status**: Ready for Implementation
**Priority**: High
**Estimated Effort**: 2-3 days

---

## Executive Summary

Implement an explicit service-worker state machine for BrowserAutoDrive's preview and execution loop. The current `previewState` object in `background/message-handlers.ts` mixes durable session data, transient timers, and UI lifecycle into a mutable bag with weak guardrails. This task replaces that with a reducer-driven session model that makes state transitions explicit, rejects stale events, survives service worker suspension, and gives popup/content-script code a stable contract.

This state machine is the control plane for extension execution. It should own step progression, confirmation gating, auto-execute timing, action-result handling, cancellation, and recovery after browser/runtime interrupts.

---

## Current State Analysis

### Existing problems

1. `previewState` combines workflow state and transport concerns in one mutable object.
2. Step lifecycle is implicit. There is no event table, versioning, or stale-message rejection.
3. `confirmCurrentStep()` clears preview and immediately advances, which hides execution failure modes.
4. `ELEMENT_SNAPSHOT`, `STEP_CONFIRM`, `STEP_SKIP`, and `USER_INTERVENED` are accepted based on broad status checks instead of exact step/session identity.
5. Timers and user intervention flags are process-local only, so service worker suspension can produce orphaned sessions or duplicate confirmations.
6. There is no durable "blocked/failed/cancelled" session outcome that downstream UI can render deterministically.

### Current control flow

```text
START_GOAL
  -> create previewState
  -> startPreview()
     -> PREVIEW_STEP to content
     -> PREVIEW_STEP to popup
ELEMENT_SNAPSHOT
  -> awaiting_confirm
  -> maybe auto-confirm
STEP_CONFIRM
  -> CLEAR_PREVIEW
  -> immediately advanceToNextStep()
```

This is sufficient for a demo loop but not for production orchestration once the action executor, retries, navigation handling, or suspend/resume behavior are introduced.

---

## Proposed Architecture

### Component boundaries

```text
Popup UI
  -> emits user intent events

Content Scripts
  -> emit observation and execution result events

Service Worker
  -> owns SessionState
  -> applies domain reducer
  -> triggers side effects after committed transitions
  -> persists resumable session snapshot
```

### Core design rule

The state machine must be pure at its core:

- reducer: `(state, event) -> nextState + effects`
- effect runner: executes Chrome/runtime side effects after transition commit
- storage adapter: persists resumable session state

Do not let message handlers mutate state ad hoc. Message handlers should:

1. validate the transport payload
2. map payload to a domain event
3. dispatch event into the reducer
4. execute returned effects

---

## State Model

### Durable session state

```ts
type SessionStatus =
  | "idle"
  | "preparing_step"
  | "previewing_step"
  | "awaiting_decision"
  | "executing_step"
  | "waiting_for_navigation"
  | "completed"
  | "failed"
  | "cancelled";

interface ExecutionSessionState {
  sessionId: string;
  goal: string;
  tabId: number;
  tier: "free" | "pro";
  autoExecute: boolean;
  autoExecuteDelayMs: number;
  status: SessionStatus;
  steps: StepDefinition[];
  currentStepIndex: number;
  currentStepAttempt: number;
  currentStepId: string | null;
  lastPreviewedAt: number | null;
  awaitingDecisionDeadlineAt: number | null;
  pendingNavigation:
    | null
    | {
        stepId: string;
        startedAt: number;
        expectedUrl?: string;
      };
  failure:
    | null
    | {
        code: string;
        message: string;
        retryable: boolean;
        stepId?: string;
      };
}
```

### Ephemeral runtime state

Keep outside persisted session data:

- in-memory timer handles
- one-shot request promises
- debug subscribers

Ephemeral state must be reconstructable from durable state after suspend/restart.

---

## Event Model

### Accepted domain events

```ts
type SessionEvent =
  | { type: "GOAL_STARTED"; goal: string; steps: StepDefinition[]; tabId: number; tier: TierType; autoExecute: boolean; autoExecuteDelayMs: number }
  | { type: "STEP_PREVIEW_REQUESTED"; stepId: string }
  | { type: "STEP_SNAPSHOT_RECEIVED"; stepId: string; snapshotFound: boolean }
  | { type: "STEP_CONFIRMED"; stepId: string; source: "user" | "auto" }
  | { type: "STEP_SKIPPED"; stepId: string; source: "user" | "system" }
  | { type: "STEP_SKIP_ALL"; stepId: string }
  | { type: "USER_INTERVENED"; stepId: string }
  | { type: "ACTION_STARTED"; stepId: string }
  | { type: "ACTION_SUCCEEDED"; stepId: string }
  | { type: "ACTION_FAILED"; stepId: string; code: string; message: string; retryable: boolean }
  | { type: "NAVIGATION_DETECTED"; stepId: string; url?: string }
  | { type: "NAVIGATION_SETTLED"; stepId: string; url: string }
  | { type: "SESSION_CANCELLED"; reason: string }
  | { type: "SESSION_RESTORED" }
  | { type: "SESSION_RESET" };
```

### Trust boundary

Transport messages are untrusted inputs, even from our own extension contexts. Every inbound event must be validated against:

- message schema
- active `sessionId`
- expected `stepId`
- allowed source context for that event
- current session status guard

If any check fails, log and drop the event. Do not mutate state.

---

## State Transition Diagram

```text
idle
  -> preparing_step

preparing_step
  -> previewing_step          preview effect dispatched
  -> failed                   no active tab / invalid plan
  -> cancelled                explicit cancel

previewing_step
  -> awaiting_decision        snapshot confirms element or preview ready
  -> preparing_step           snapshot missing and policy says skip
  -> failed                   preview transport/action irrecoverable
  -> cancelled                explicit cancel

awaiting_decision
  -> executing_step           user confirm or auto-confirm
  -> preparing_step           skip current step
  -> cancelled                skip all / explicit cancel
  -> failed                   stale tab / invalid active step

executing_step
  -> preparing_step           action success and more steps remain
  -> completed                action success on final step
  -> waiting_for_navigation   action initiated navigation
  -> awaiting_decision        retryable failure after re-preview
  -> failed                   non-retryable failure
  -> cancelled                explicit cancel

waiting_for_navigation
  -> preparing_step           navigation settled and more steps remain
  -> completed                navigation settled on final step
  -> awaiting_decision        retryable post-navigation failure
  -> failed                   timeout or terminal navigation failure
  -> cancelled                explicit cancel

completed
  -> idle                     reset

failed
  -> idle                     reset

cancelled
  -> idle                     reset
```

---

## Sequence Diagrams

### Happy path

```text
Popup           Service Worker         Content Script
  | START_GOAL        |                      |
  |------------------>|                      |
  |                   | GOAL_STARTED        |
  |                   | state=preparing     |
  |                   | PREVIEW_STEP        |
  |                   |-------------------->|
  |                   | state=previewing    |
  |                   |                     |
  |                   | STEP_SNAPSHOT       |
  |                   |<--------------------|
  |                   | state=awaiting_decision
  | STEP_CONFIRM      |                     |
  |------------------>|                     |
  |                   | CLEAR_PREVIEW       |
  |                   |-------------------->|
  |                   | EXECUTE_ACTION      |
  |                   |-------------------->|
  |                   | state=executing     |
  |                   | ACTION_SUCCEEDED    |
  |                   |<--------------------|
  |                   | next step / done    |
  | PREVIEW_STEP/DONE |                     |
  |<------------------|                     |
```

### Retryable failure

```text
Popup           Service Worker         Content Script
  | STEP_CONFIRM      |                      |
  |------------------>|                      |
  |                   | EXECUTE_ACTION       |
  |                   |--------------------->|
  |                   | ACTION_FAILED(retryable)
  |                   |<---------------------|
  |                   | state=awaiting_decision
  |                   | re-emit PREVIEW_STEP with error context
  | ERROR + PREVIEW   |                      |
  |<------------------|                      |
```

### Service worker suspend / restore

```text
Browser Runtime     Service Worker        Storage
  | suspend               |                  |
  |---------------------->| persist session? |
  |                       |----------------->|
  | restart               |                  |
  |---------------------->| load snapshot    |
  |                       |<-----------------|
  |                       | SESSION_RESTORED |
  |                       | rebuild timers   |
  |                       | re-drive state   |
```

---

## Guard Conditions

### Event acceptance matrix

| Event | Valid statuses | Required checks |
|------|----------------|-----------------|
| `STEP_SNAPSHOT_RECEIVED` | `previewing_step` | `stepId === currentStepId`, sender is content script for active tab |
| `STEP_CONFIRMED` | `awaiting_decision` | `stepId === currentStepId`, popup source or auto timer owned by current session |
| `STEP_SKIPPED` | `previewing_step`, `awaiting_decision` | `stepId === currentStepId` |
| `USER_INTERVENED` | `previewing_step`, `awaiting_decision` | same step, same tab |
| `ACTION_SUCCEEDED` | `executing_step` | same session and step |
| `ACTION_FAILED` | `executing_step`, `waiting_for_navigation` | same session and step |
| `NAVIGATION_SETTLED` | `waiting_for_navigation` | same step, active tab unchanged or intentionally replaced |

### Non-negotiable rules

1. Ignore stale step events after the state machine advances.
2. Auto-execute must only fire if the session is still in `awaiting_decision` for the same `stepId`.
3. `STEP_CONFIRM` during `previewing_step` should not directly execute unless preview readiness is explicit; otherwise queue nothing and reject.
4. `START_GOAL` while a session is active must either:
   - reject with `session_already_active`, or
   - cancel-and-replace via an explicit policy flag.

Recommend default: reject unless the user explicitly resets.

---

## Side Effects

### Effects emitted by reducer

```ts
type SessionEffect =
  | { type: "SEND_PREVIEW_STEP"; step: StepDefinition; tabId: number }
  | { type: "SEND_CLEAR_PREVIEW"; tabId: number; done?: boolean }
  | { type: "SEND_EXECUTE_ACTION"; step: StepDefinition; tabId: number }
  | { type: "SCHEDULE_AUTO_CONFIRM"; stepId: string; delayMs: number }
  | { type: "CANCEL_AUTO_CONFIRM" }
  | { type: "PERSIST_SESSION" }
  | { type: "CLEAR_PERSISTED_SESSION" }
  | { type: "EMIT_POPUP_STATUS"; session: ExecutionSessionState }
  | { type: "LOG_TRANSITION"; from: SessionStatus; event: SessionEvent["type"]; to: SessionStatus };
```

### Why this split matters

The reducer stays deterministic and testable. Chrome API calls, timers, and storage writes move into effect handlers where failures can be retried or degraded without corrupting state transitions.

---

## Persistence and Recovery

### Persisted snapshot

Store minimal session state in `chrome.storage.session` if available, with fallback to `chrome.storage.local` under a namespaced key such as `bad.activeSession`.

Persist on:

- goal start
- each committed state transition
- failure / cancel / complete

### Recovery policy

On worker startup:

1. load persisted session
2. if none exists, stay `idle`
3. if status was `awaiting_decision`, rebuild auto-confirm timer only if deadline is still in the future
4. if status was `executing_step` or `waiting_for_navigation`, mark session `failed` with `service_worker_restarted_mid_execution` unless there is a reliable executor handshake proving completion
5. emit popup status so UI can reconcile

Recommendation: fail closed on mid-execution restore. Do not silently advance a step after restart.

---

## Data Flow

```text
chrome.runtime.onMessage
  -> message router validation
  -> transport-to-domain mapping
  -> session reducer
  -> effect queue
  -> Chrome/storage side effects
  -> popup/content notifications
```

The only write path to session state must be the reducer. Logging, metrics, and debug inspection should consume state, never mutate it.

---

## Failure Modes

### 1. Snapshot never arrives

- transition from `previewing_step` to `failed` or `preparing_step` based on policy
- recommend timeout with `selector_resolution_timeout`

### 2. Popup closes mid-session

- do not cancel execution
- continue session ownership in worker
- popup resubscribes by requesting current session state on open

### 3. User clicks confirm twice

- first valid event transitions to `executing_step`
- subsequent confirms are stale and ignored

### 4. Step result arrives for prior step

- reject as stale event
- log with `sessionId`, `expectedStepId`, `receivedStepId`

### 5. Active tab changes unexpectedly

- validate against `tabId`
- fail closed with `active_tab_changed`

### 6. Worker restart during action

- mark `failed`
- surface explicit recovery message to popup

### 7. Skip-all during execution

- do not interrupt content script mid-action unless cancellation is a supported executor feature
- record cancellation request and apply after current action settles

---

## Implementation Plan

### 1. Introduce domain module

Create:

- `background/session-state-machine.ts`
- `background/session-types.ts`
- `background/session-effects.ts`

Responsibilities:

- reducer and transition table
- state/event/effect types
- helper guards for active session and active step

### 2. Refactor message handlers

Update `background/message-handlers.ts` so handlers become thin adapters:

- validate payload and sender
- dispatch domain event
- execute resulting effects

Remove direct mutation of `previewState`, `userIntervenedForStep`, and timer logic from handler bodies.

### 3. Introduce session persistence

Add a storage adapter for persisted session snapshots and startup restoration in `service-worker-v2.ts`.

### 4. Align message contracts

Extend `shared/messages.ts` as needed to carry:

- `sessionId`
- exact `stepId`
- optional failure codes and status payloads

The popup and content scripts should never infer session identity from local UI state alone.

### 5. Add debug inspection

Expose current session snapshot and recent transition log for local debugging/tests.

---

## Test Matrix

### Reducer unit tests

| Scenario | Expected result |
|---------|-----------------|
| `GOAL_STARTED` from `idle` | session enters `preparing_step`, emits preview effect |
| snapshot success | `previewing_step -> awaiting_decision` |
| snapshot missing with skip policy | `previewing_step -> preparing_step` on next step |
| confirm valid step | `awaiting_decision -> executing_step` |
| stale confirm | no transition |
| action success with remaining steps | `executing_step -> preparing_step` |
| final step success | `executing_step -> completed` |
| retryable failure | `executing_step -> awaiting_decision` with failure context |
| terminal failure | `executing_step -> failed` |
| cancel from active state | `-> cancelled` |

### Effect runner tests

| Scenario | Assertion |
|---------|-----------|
| schedule auto-confirm | prior timer cancelled, new timer bound to current step |
| popup closed | effect resolves without state corruption |
| content script missing | warning logged, state moves to failure/timeout path not silent success |
| persist snapshot | latest committed state written after transition |

### Integration tests

| Flow | Coverage |
|-----|----------|
| start goal through final step | full happy path |
| user skips first step | next step previews correctly |
| auto-execute pro flow | timer confirms current step only |
| stale message after step advance | ignored |
| service worker restore from `awaiting_decision` | timer rebuilt, state preserved |
| service worker restore from `executing_step` | failure surfaced, no silent advance |
| navigation step | `executing_step -> waiting_for_navigation -> preparing_step/completed` |

### Manual QA

1. Start a goal with popup open, confirm each step, verify deterministic state updates.
2. Start a goal, close popup, reopen, verify session status is restored.
3. Trigger user intervention before auto-confirm fires and verify the timer is cancelled.
4. Force a content-script failure and verify popup shows terminal vs retryable error correctly.
5. Reload the extension while awaiting confirmation and verify the session resumes instead of resetting silently.

---

## Recommended Defaults

1. Single active session per browser profile.
2. Fail closed on ambiguous recovery.
3. Reject stale or out-of-order events instead of attempting best-effort reconciliation.
4. Persist durable state on every transition.
5. Keep timer handles and transport promises out of persisted state.

---

## Engineer Handoff

### Implementation owner

Assign to an engineer working in:

- `browserautodrive/packages/extension/background/`
- `browserautodrive/packages/extension/shared/messages.ts`

### Review routing

When implementation is ready, route to the **Staff Engineer** for code review with focus on:

- reducer purity
- stale event rejection
- suspend/recovery semantics
- test coverage depth

### Definition of done

1. Ad hoc `previewState` mutation is replaced by an explicit reducer/state machine.
2. Session identity and step identity are validated on every inbound event.
3. Recovery behavior after service worker restart is deterministic and tested.
4. Popup/content integration uses explicit state/status messages.
5. Unit and integration coverage exists for happy path, stale events, retries, cancellation, and restart recovery.
