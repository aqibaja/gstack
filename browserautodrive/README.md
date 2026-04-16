# BrowserAutoDrive

AI-powered browser automation — enter a natural language goal and the agent navigates, clicks, types, and extracts data autonomously.

## Quick Start

```bash
# Install dependencies
npm install

# Build all packages
npx turbo build

# Run tests
npx turbo test

# Run the CLI
npx browserautodrive run "Book a flight from SFO to JFK on 2026-05-01" --api-key YOUR_KEY

# Parse a goal without executing
npx browserautodrive parse "Search for TypeScript tutorials on Google."
```

## Architecture

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  GoalParser  │───▶│   Planner   │───▶│  AgentLoop  │
│  (NL→Goal)   │    │ (Goal→Plan) │    │  (OODA)     │
└─────────────┘    └─────────────┘    └──────┬──────┘
                                              │
                    ┌─────────────────────────┼──────────────────┐
                    │                         │                  │
              ┌─────▼─────┐          ┌────────▼──────┐  ┌───────▼───────┐
              │  Browser  │          │   Observer    │  │  SafetyGuard  │
              │ (Playwright)│        │ (DOM extract) │  │ (validation)  │
              └───────────┘          └──────────────┘  └───────────────┘
                                              │
                                      ┌───────▼───────┐
                                      │  LLM Provider  │
                                      │ (GLM5/OpenAI)  │
                                      └───────────────┘
```

## Packages

| Package | Description |
|---------|-------------|
| `@browserautodrive/core` | Agent loop, state machine, GoalParser, Planner, SessionMemory, Logger |
| `@browserautodrive/browser` | Playwright browser control layer |
| `@browserautodrive/observe` | Observation system (DOM extraction, screenshots) |
| `@browserautodrive/llm` | LLM provider adapters (GLM-5, OpenAI-compatible) |
| `@browserautodrive/safety` | Action validation, safety guard, SSRF protection |
| `@browserautodrive/cli` | Command-line interface |
| `@browserautodrive/eval` | Evaluation framework and test suites |

## OODA State Machine

The agent operates in the Observe→Orient→Decide→Act cycle:

```
goal_start → plan_ok → executing ⇄ step_ok
                          ↓ step_fail
                       recovering → retry_ok → executing
                          ↓ retry_fail
                       confidence_low → human_assist → human_resolved → executing
                                                       → human_cancelled
goal_done ← complete
```

## Safety Features

- **SSRF Protection**: Blocks navigation to private/internal hosts
- **Prompt Injection Sanitization**: Rejects injection patterns in goals
- **High-Stakes Action Confirmation**: Requires human approval for submit/purchase/delete
- **Confidence Threshold**: Pauses for human input below threshold
- **Max Actions Cap**: Stops after configurable action limit (default: 50)

## Development

```bash
# Build a specific package
npx turbo build --filter=@browserautodrive/core

# Run tests for a specific package
cd packages/eval && npx jest --no-coverage

# Run the flight search demo
npx ts-node demos/flight-search-demo.ts
```

## License

MIT
