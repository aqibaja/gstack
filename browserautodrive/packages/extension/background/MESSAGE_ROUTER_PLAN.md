# Task 1.5: Service Worker — Message Router
## Technical Execution Plan

**Status**: Ready for Implementation
**Priority**: High
**Estimated Effort**: 2-3 days

---

## Executive Summary

Implement a centralized message router for the BrowserAutoDrive Chrome extension service worker. The current implementation has a monolithic message handler that lacks validation, structured error handling, and clean separation of concerns. This task will create a modular, type-safe message routing system that enables reliable communication between the service worker, popup, and content scripts.

---

## Current State Analysis

### Issues with Current Implementation

1. **Monolithic Handler**: Single `chrome.runtime.onMessage.addListener` with switch statement
2. **No Validation**: Messages not validated against shared types in `shared/messages.ts`
3. **No Request/Response Pattern**: No clean async communication pattern
4. **No Message Forwarding**: No clean way to forward messages between contexts
5. **No Structured Error Handling**: Basic error catching without structured handling
6. **No Logging**: No debugging capabilities for message flow

### Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Current Service Worker                       │
├─────────────────────────────────────────────────────────────┤
│  chrome.runtime.onMessage.addListener()                     │
│    └─ switch (message.type)                                 │
│        ├─ case "ELEMENT_SNAPSHOT"                           │
│        ├─ case "STEP_CONFIRM"                               │
│        ├─ case "STEP_SKIP"                                  │
│        ├─ case "USER_INTERVENED"                            │
│        └─ case "START_GOAL"                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Proposed Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Service Worker                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │  Message Router │    │ Message Validator│                │
│  │  (Router)       │◄──►│ (Validator)      │                │
│  └────────┬────────┘    └─────────────────┘                │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │ Handler Registry│    │ Request Manager │                │
│  │ (Registry)      │    │ (Manager)       │                │
│  └────────┬────────┘    └─────────────────┘                │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────────────────────────────┐               │
│  │         Message Handlers                 │               │
│  │  ├─ ElementSnapshotHandler               │               │
│  │  ├─ StepConfirmHandler                   │               │
│  │  ├─ StepSkipHandler                      │               │
│  │  ├─ UserIntervenedHandler                │               │
│  │  └─ StartGoalHandler                     │               │
│  └─────────────────────────────────────────┘               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow Diagram

```
┌─────────────┐         ┌─────────────────┐         ┌─────────────┐
│   Popup     │         │ Service Worker  │         │  Content    │
│   (UI)      │         │ (Message Router)│         │  Scripts    │
└──────┬──────┘         └────────┬────────┘         └──────┬──────┘
       │                         │                         │
       │ 1. STEP_CONFIRM         │                         │
       │────────────────────────►│                         │
       │                         │                         │
       │                         │ 2. Validate & Route     │
       │                         │─────────────┐           │
       │                         │             │           │
       │                         │◄────────────┘           │
       │                         │                         │
       │                         │ 3. Handle Request       │
       │                         │─────────────┐           │
       │                         │             │           │
       │                         │◄────────────┘           │
       │                         │                         │
       │                         │ 4. Send to Content      │
       │                         │────────────────────────►│
       │                         │                         │
       │                         │ 5. Response             │
       │                         │◄────────────────────────│
       │                         │                         │
       │ 6. Update UI            │                         │
       │◄────────────────────────│                         │
       │                         │                         │
```

---

## Implementation Details

### 1. Message Router (`message-router.ts`)

**Purpose**: Centralized message routing and request/response handling

**Key Features**:
- Route registration and management
- Message validation and routing
- Request/response pattern with timeouts
- Message sending to different contexts (tabs, popup)
- Error handling and logging

**API**:
```typescript
class MessageRouter {
  initialize(): void
  registerRoute(route: MessageRoute): void
  registerRoutes(routes: MessageRoute[]): void
  sendRequest<T>(target: string, message: ExtensionMessage, config?: RequestConfig): Promise<T>
  sendMessageToTab(tabId: number, message: unknown): Promise<void>
  sendMessageToPopup(message: unknown): Promise<void>
  destroy(): void
}
```

### 2. Message Validator (`message-validator.ts`)

**Purpose**: Validate messages against shared types and schemas

**Key Features**:
- Type-safe validation for all message types
- Detailed error messages for debugging
- Schema validation for complex payloads

**API**:
```typescript
function validateExtensionMessage(message: unknown): message is ExtensionMessage
function getValidationErrorMessage(message: unknown): string | null
```

### 3. Message Handlers (`message-handlers.ts`)

**Purpose**: Define all message handlers for the service worker

**Key Features**:
- Modular handler registration
- State management
- Preview flow orchestration
- Auto-execute logic

**Handlers**:
- `ELEMENT_SNAPSHOT`: Handle element snapshot from content script
- `STEP_CONFIRM`: Handle step confirmation from popup
- `STEP_SKIP`: Handle step skip from popup
- `STEP_SKIP_ALL`: Handle skip all steps from popup
- `AUTO_EXECUTE_TIMEOUT`: Handle auto-execute timeout
- `USER_INTERVENED`: Handle user intervention from popup
- `TIER_CONFIG`: Handle tier configuration update
- `START_GOAL`: Handle goal start from popup

### 4. Service Worker (`service-worker-v2.ts`)

**Purpose**: Main entry point and initialization

**Key Features**:
- Initialize message router and handlers
- Enhanced message handling with validation
- Lifecycle management
- Global error handling
- Debug utilities

---

## Message Types

### Supported Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `PREVIEW_STEP` | SW → Content | Preview a step on the page |
| `CLEAR_PREVIEW` | SW → Content | Clear step preview |
| `ELEMENT_SNAPSHOT` | Content → SW | Element snapshot response |
| `STEP_CONFIRM` | Popup → SW | Confirm step execution |
| `STEP_SKIP` | Popup → SW | Skip current step |
| `STEP_SKIP_ALL` | Popup → SW | Skip all remaining steps |
| `AUTO_EXECUTE_TIMEOUT` | Internal | Auto-execute timeout |
| `USER_INTERVENED` | Popup → SW | User intervention |
| `TIER_CONFIG` | SW → Popup | Tier configuration |
| `START_GOAL` | Popup → SW | Start goal execution |

### Message Schema

All messages follow the `ExtensionMessage` type from `shared/messages.ts`:

```typescript
interface ExtensionMessage {
  type: string
  payload: Record<string, unknown>
}
```

Each message type has specific payload requirements validated by the message validator.

---

## Edge Cases and Failure Modes

### 1. Invalid Messages

**Scenario**: Malformed message received
**Handling**: Validate message structure and return validation error
**Logging**: Log warning with validation error details

### 2. Unknown Message Type

**Scenario**: Message with unregistered type received
**Handling**: Log warning and ignore message
**Logging**: Log warning with unknown type

### 3. Handler Errors

**Scenario**: Message handler throws error
**Handling**: Catch error and return error response
**Logging**: Log error with stack trace

### 4. Request Timeouts

**Scenario**: Request/response timeout
**Handling**: Reject promise with timeout error
**Logging**: Log warning with timeout details

### 5. Content Script Not Injected

**Scenario**: Send message to tab without content script
**Handling**: Silently ignore error
**Logging**: Log warning (not error) for debugging

### 6. Popup Not Open

**Scenario**: Send message to popup when closed
**Handling**: Silently ignore error
**Logging**: No logging (expected behavior)

### 7. Service Worker Suspension

**Scenario**: Service worker suspended by browser
**Handling**: Clean up resources on suspend
**Logging**: Log suspension event

### 8. Duplicate Route Registration

**Scenario**: Register route with same type twice
**Handling**: Warn and skip duplicate
**Logging**: Log warning with duplicate type

---

## Test Coverage Plan

### Unit Tests

1. **Message Router Tests**
   - Initialization
   - Route registration
   - Message handling
   - Request/response pattern
   - Error handling
   - Cleanup

2. **Message Validator Tests**
   - Valid message validation
   - Invalid message rejection
   - Error message generation
   - Type-specific validation

3. **Message Handler Tests**
   - Handler registration
   - Handler execution
   - State management
   - Error handling

### Integration Tests

1. **Message Flow Tests**
   - Complete preview flow
   - Step confirmation flow
   - Step skip flow
   - User intervention flow

2. **Error Handling Tests**
   - Invalid message handling
   - Handler error recovery
   - Timeout handling

### E2E Tests

1. **Extension Integration**
   - Popup ↔ Service Worker communication
   - Service Worker ↔ Content Script communication
   - Complete automation flow

---

## Implementation Checklist

### Phase 1: Core Infrastructure (Day 1)

- [ ] Create `message-router.ts` with core routing logic
- [ ] Create `message-validator.ts` with validation functions
- [ ] Create `message-handlers.ts` with handler definitions
- [ ] Create `service-worker-v2.ts` with initialization
- [ ] Write unit tests for message router
- [ ] Write unit tests for message validator

### Phase 2: Handler Implementation (Day 2)

- [ ] Implement all message handlers
- [ ] Integrate with existing state management
- [ ] Add error handling and logging
- [ ] Write unit tests for handlers
- [ ] Write integration tests

### Phase 3: Integration and Testing (Day 3)

- [ ] Update manifest to use new service worker
- [ ] Test popup ↔ service worker communication
- [ ] Test service worker ↔ content script communication
- [ ] Write E2E tests
- [ ] Update documentation

---

## Dependencies

### Internal Dependencies

- `shared/messages.ts`: Message type definitions
- `content/preview.ts`: Content script message handling
- `popup/popup.ts`: Popup message handling

### External Dependencies

- Chrome Extension APIs (`chrome.runtime`, `chrome.tabs`, `chrome.storage`)
- TypeScript 4.x+
- Jest for testing

---

## Success Criteria

1. **All messages validated** against shared types
2. **All handlers registered** and functional
3. **Request/response pattern** working for async operations
4. **Error handling** for all failure modes
5. **Test coverage** ≥ 80%
6. **No regressions** in existing functionality
7. **Documentation** updated

---

## Risks and Mitigations

### Risk 1: Breaking Changes

**Description**: New implementation may break existing functionality
**Mitigation**: Thorough testing, gradual rollout, feature flags

### Risk 2: Performance Impact

**Description**: Additional validation may impact performance
**Mitigation**: Efficient validation, caching, profiling

### Risk 3: Browser Compatibility

**Description**: Chrome API differences across versions
**Mitigation**: Feature detection, fallbacks, testing

---

## Handoff

When implementation is complete, hand off to:
- **Staff Engineer**: For code review
- **Release Engineer**: For release preparation
- **QA Engineer**: For testing and validation

---

## References

- `shared/messages.ts`: Message type definitions
- `CHROME_EXTENSION_PLAN.md`: Product plan
- Chrome Extension Manifest V3 documentation
- Chrome Extension Messaging documentation