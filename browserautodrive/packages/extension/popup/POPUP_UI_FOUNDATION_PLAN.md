# Popup UI Foundation Execution Plan

## Decision

Implement the popup as a React application with CSS Modules and keep the background service worker as the source of truth for execution state.

This replaces the current hand-managed DOM popup implementation for this ticket. The existing vanilla popup is useful as a behavior prototype, but it does not satisfy the approved requirement for React plus CSS Modules and it will become harder to evolve once the background/message router work lands.

## Objectives

- Provide a stable popup shell for goal entry, step preview, status display, and controls.
- Isolate view rendering from Chrome runtime plumbing.
- Preserve MV3 compatibility by keeping long-lived execution state in the background service worker, not the popup window.
- Define a message contract that remains safe when the popup opens, closes, or reconnects mid-run.

## Non-Goals

- No options page work in this task.
- No full agent loop integration in this task.
- No execution engine changes beyond the popup-facing message contract needed to render state.

## Architecture

### Component Diagram

```text
+-----------------------+        runtime messaging        +------------------------+
| Popup React App       | <----------------------------> | Background Service     |
|                       |                                | Worker                 |
| - PopupApp            |                                |                        |
| - GoalComposer        |                                | - preview state store  |
| - StatusBar           |                                | - command handlers     |
| - StepCard            |                                | - popup sync endpoint  |
| - ControlBar          |                                | - tab/content bridge   |
+-----------+-----------+                                +-----------+------------+
            |                                                            |
            | local UI state                                              | tab messaging
            v                                                            v
+-----------------------+                                +------------------------+
| CSS Modules           |                                | Content Scripts        |
| - PopupShell.module   |                                | - overlay preview      |
| - StepCard.module     |                                | - DOM observe/execute  |
| - Controls.module     |                                +------------------------+
+-----------------------+
```

### Trust Boundaries

- Popup is untrusted from a state-authority perspective. It can send user intent, but it cannot be the canonical owner of step progress.
- Service worker is the authority for current run status, step index, tier, and auto-execute eligibility.
- Content scripts are trusted only for page-local observation/execution data. They must not mutate popup state directly.
- Messages from outside the extension are rejected by sender validation.

## Data Model

The popup should render a single normalized view model from the worker rather than reconstructing state from ad hoc messages.

```ts
type PopupScreen = "idle" | "preview" | "executing" | "done" | "error";

interface PopupViewModel {
  screen: PopupScreen;
  goalDraft: string;
  tier: "free" | "pro";
  autoExecuteEnabled: boolean;
  autoExecuteDelayMs: number;
  run: {
    goal: string;
    status: "idle" | "previewing" | "awaiting_confirm" | "executing" | "done" | "failed";
    currentStepIndex: number;
    totalSteps: number;
  } | null;
  step: {
    stepId: string;
    stepNumber: number;
    totalSteps: number;
    selector: string;
    action: string;
    value?: string;
    reasoning: string;
  } | null;
  error: {
    code: string;
    message: string;
    recoverable: boolean;
  } | null;
}
```

## Message Contract

### Required Changes

- Keep existing command messages from popup to worker:
  - `START_GOAL`
  - `STEP_CONFIRM`
  - `STEP_SKIP`
  - `USER_INTERVENED`
- Add a worker-owned sync path:
  - `POPUP_READY`
  - `POPUP_STATE`
  - `POPUP_ERROR`
- Keep `TIER_CONFIG`, but fold it into the full popup state payload to avoid split-brain rendering.

### Sequence Diagram

```text
Popup                Service Worker                 Content Script
  |                        |                              |
  |--- POPUP_READY ------->|                              |
  |<-- POPUP_STATE --------|                              |
  |                        |                              |
  |--- START_GOAL -------->|                              |
  |                        |--- PREVIEW_STEP -----------> |
  |                        |<-- ELEMENT_SNAPSHOT -------- |
  |<-- POPUP_STATE --------|                              |
  |                        |                              |
  |--- STEP_CONFIRM ------>|                              |
  |                        |--- CLEAR_PREVIEW --------->  |
  |                        |--- EXECUTE / ADVANCE ----->  |
  |<-- POPUP_STATE --------|                              |
```

### Why `POPUP_READY`

The popup lifecycle is ephemeral in MV3. When the user reopens the popup during an active run, the UI must request the latest state instead of waiting for the next worker push. Without an explicit ready/sync handshake, the popup can render stale idle state while execution is already underway.

## UI State Machine

### Popup Rendering States

```text
idle
  -> preview      on POPUP_STATE with step + awaiting_confirm/previewing
  -> executing    on POPUP_STATE with status=executing
  -> done         on POPUP_STATE with status=done
  -> error        on POPUP_ERROR or failed state

preview
  -> executing    on STEP_CONFIRM accepted
  -> idle         on reset/clear with no active run
  -> done         on worker reports completion
  -> error        on worker reports failure

executing
  -> preview      on next pending step
  -> done         on final completion
  -> error        on execution failure

done
  -> idle         on New Goal

error
  -> idle         on dismiss/reset
```

### Worker State Ownership

- Popup local state:
  - current goal input draft
  - transient button disabled/loading flags during request dispatch
- Worker-owned state:
  - active run existence
  - step identity and progression
  - tier and auto-execute policy
  - terminal status and recoverable errors

## Recommended File Layout

```text
packages/extension/popup/
  popup.html
  main.tsx
  PopupApp.tsx
  components/
    GoalComposer.tsx
    StatusBar.tsx
    StepCard.tsx
    ControlBar.tsx
  hooks/
    usePopupRuntime.ts
  state/
    popup-view-model.ts
  styles/
    PopupShell.module.css
    StepCard.module.css
    Controls.module.css
```

## Build Decision

Use Vite for the popup bundle and keep plain TypeScript compilation for background/content until those surfaces need their own bundling.

Reasoning:

- React plus CSS Modules needs a frontend bundler; raw `tsc` is not enough.
- Limiting Vite to the popup keeps migration risk small.
- MV3 popup is a standard HTML entry point, so Vite fits cleanly.

## Migration Plan

1. Add popup-local React toolchain:
   - `react`
   - `react-dom`
   - `vite`
   - `@vitejs/plugin-react`
2. Update extension package build so popup assets are bundled into `dist/popup/`.
3. Replace direct DOM querying in `popup.ts` with a React app entrypoint.
4. Introduce `usePopupRuntime` hook:
   - sends `POPUP_READY` on mount
   - subscribes to runtime messages
   - exposes `startGoal`, `confirmStep`, `skipStep`, `toggleAutoExecute`, `reset`
5. Normalize worker payloads into `PopupViewModel`.
6. Move styling into CSS Modules and preserve current product behavior:
   - goal input
   - step card
   - tier badge
   - auto-execute control
   - completion state

## Failure Modes

| Failure | Expected handling |
|---|---|
| Popup opens mid-run | Popup sends `POPUP_READY`; worker replies with current `POPUP_STATE` immediately |
| Popup closes during run | Execution continues in worker; no state loss |
| Content script missing on active tab | Worker reports recoverable error state; popup shows retry guidance |
| Active tab unavailable | Worker rejects `START_GOAL`; popup shows non-recoverable error |
| `STEP_CONFIRM` for stale `stepId` | Worker ignores command and returns fresh `POPUP_STATE` |
| Auto-execute toggled in free tier | Worker persists `false` and returns authoritative state |
| Worker restarts | Popup re-handshakes with `POPUP_READY`; worker rebuilds view from storage if persisted, otherwise returns idle |
| Message delivery to closed popup fails | Worker treats popup push as best-effort and keeps state internally |

## Edge Cases

- Double click on Confirm or Skip must not enqueue duplicate commands.
- A step can advance while the popup is open but unfocused; the next worker push must replace the old step card atomically.
- Goal submission with empty or whitespace-only input stays local and does not message the worker.
- If tier changes while popup is open, the worker state update must remove or disable auto-execute controls in the same render pass.
- Selector text and reasoning can be long; UI must wrap safely without resizing past popup width.

## Test Matrix

### Unit

- `usePopupRuntime` maps worker messages into `PopupViewModel` correctly.
- Step card renders action, reasoning, selector, and progress.
- Control buttons disable while a command is in flight.
- Auto-execute control is hidden for free tier and visible for pro tier.

### Integration

- Popup mount sends `POPUP_READY` and consumes `POPUP_STATE`.
- `START_GOAL` dispatches correct runtime message.
- `STEP_CONFIRM` and `STEP_SKIP` include the current `stepId`.
- Reopening popup during active preview hydrates the current step instead of idle UI.

### Worker/Contract

- `POPUP_STATE` schema stays aligned with shared message types.
- Stale step commands are ignored safely.
- Worker push to popup is best-effort and does not fail the run when popup is closed.

### Manual QA

- Fresh install: idle state loads with free tier defaults.
- Active preview: step card matches highlighted page element.
- Pro tier: auto-execute toggle persists across popup reopen.
- Completed run: done state appears and reset returns to idle.
- Worker restart / extension reload: popup recovers to authoritative state.

## Implementation Handoff

### Engineer 1: Popup foundation

- Own popup React migration, CSS Modules, and `usePopupRuntime`.
- Do not change content-script execution semantics beyond contract wiring.

### Engineer 2: Worker contract alignment

- Own `POPUP_READY`/`POPUP_STATE` support and any shared message-type updates.
- Ensure popup sync is resilient to popup closure and worker restarts.

### QA

- Validate popup lifecycle recovery and command correctness across free/pro tier variants.

## Exit Criteria

- Popup renders from worker-owned state after reopen without manual refresh.
- No direct DOM query/manipulation remains in popup application logic.
- Styles are delivered via CSS Modules.
- Shared popup contract is typed and covered by tests.
- Manual QA passes for idle, preview, executing, done, and error states.
