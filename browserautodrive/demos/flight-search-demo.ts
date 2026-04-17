#!/usr/bin/env node
/**
 * BrowserAutoDrive — Flight Search Demo
 *
 * Demonstrates the full GoalParser → Planner → AgentLoop pipeline
 * with a simulated flight booking scenario.
 *
 * Usage:
 *   node demos/flight-search-demo.ts    # Full demo with mock LLM
 *   npx browserautodrive run "Book a flight from SFO to JFK on 2026-05-01" --api-key YOUR_KEY
 */

import {
  GoalParser,
  Planner,
  AgentLoop,
  ProgressEvent,
  StructuredGoal,
} from "@browserautodrive/core";
import { SafetyGuard } from "@browserautodrive/safety";

// ─── Simulated LLM for demo (no real API key needed) ────────────────────────

class DemoLLMProvider {
  private stepIndex = 0;

  private readonly flightScenario = [
    {
      action: { type: "navigate", url: "https://www.google.com/travel/flights" },
      reasoning: "Navigate to Google Flights to search for SFO→JFK",
      confidence: 0.95,
    },
    {
      action: { type: "type", target: { selector: "[aria-label='Where from?']", confidence: 0.9 }, text: "SFO", description: "Enter origin airport" },
      reasoning: "Type SFO as the departure airport",
      confidence: 0.9,
    },
    {
      action: { type: "type", target: { selector: "[aria-label='Where to?']", confidence: 0.9 }, text: "JFK", description: "Enter destination airport" },
      reasoning: "Type JFK as the arrival airport",
      confidence: 0.9,
    },
    {
      action: { type: "click", target: { selector: "[aria-label='Departure date']", confidence: 0.9 }, description: "Open date picker" },
      reasoning: "Click the date picker to set departure date",
      confidence: 0.85,
    },
    {
      action: { type: "click", target: { selector: "[data-date='2026-05-01']", confidence: 0.85 }, description: "Select May 1st" },
      reasoning: "Select May 1, 2026 as the departure date",
      confidence: 0.85,
    },
    {
      action: { type: "click", target: { selector: "[aria-label='Search']", confidence: 0.9 }, description: "Submit flight search" },
      reasoning: "Click the search button to find flights",
      confidence: 0.9,
    },
    {
      action: { type: "extract", description: "Flight search results", dataType: "text" },
      reasoning: "Extract flight results for the user",
      confidence: 0.8,
    },
    {
      action: { type: "done", result: "Found 12 flights from SFO to JFK on May 1st, starting from $342", success: true },
      reasoning: "Search completed successfully",
      confidence: 1.0,
    },
  ];

  async complete(prompt: any): Promise<any> {
    const step = this.flightScenario[this.stepIndex] ?? {
      action: { type: "done", result: "Demo completed", success: true },
      reasoning: "No more steps",
      confidence: 1.0,
    };
    this.stepIndex++;

    // Simulate LLM latency
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));

    return step;
  }

  async validateApiKey(): Promise<boolean> {
    return true;
  }
}

// ─── Simulated Browser for demo ──────────────────────────────────────────────

class DemoBrowserController {
  async executeAction(page: any, action: any): Promise<{ success: boolean; error?: string }> {
    await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
    console.log(`  🔧 Browser: ${action.type}${action.target ? ` → ${action.target.selector}` : ""}${action.text ? ` "${action.text}"` : ""}${action.url ? ` → ${action.url}` : ""}`);
    return { success: true };
  }
}

// ─── Simulated Observer ──────────────────────────────────────────────────────

class DemoObserver {
  async observe(page: any): Promise<any> {
    return {
      url: "https://www.google.com/travel/flights",
      title: "Google Flights",
      screenshot: "base64",
      accessibilityTree: { role: "root", name: "Google Flights", children: [] },
      interactiveElements: [
        { selector: "[aria-label='Where from?']", text: "", role: "textbox", confidence: 0.9 },
        { selector: "[aria-label='Where to?']", text: "", role: "textbox", confidence: 0.9 },
        { selector: "[aria-label='Departure date']", text: "Date", role: "button", confidence: 0.85 },
        { selector: "[aria-label='Search']", text: "Search", role: "button", confidence: 0.9 },
      ],
      viewportSize: { width: 1280, height: 720 },
      scrollPosition: { x: 0, y: 0 },
      timestamp: Date.now(),
    };
  }
}

// ─── Simulated Human Interface ────────────────────────────────────────────────

class DemoHumanInterface {
  async askQuestion(question: string, options?: string[]): Promise<string> {
    console.log(`\n  🙋 Human assist requested: ${question}`);
    console.log(`     Auto-responding: "Continue"`);
    return "Continue";
  }

  async confirmAction(action: any): Promise<boolean> {
    console.log(`\n  ⚠️  High-stakes action: ${action.type} — auto-confirming`);
    return true;
  }
}

// ─── Main Demo ────────────────────────────────────────────────────────────────

async function main() {
  const goalInput = process.argv[2] || "Book a flight from SFO to JFK on 2026-05-01.";

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║          BrowserAutoDrive — Flight Search Demo              ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  // Step 1: Parse goal
  console.log("📋 Step 1: Parsing goal...");
  const parser = new GoalParser();
  const parseResult = parser.parse(goalInput);

  console.log(`   Objective: ${parseResult.goal.objective}`);
  if (parseResult.goal.origin) console.log(`   Origin: ${parseResult.goal.origin}`);
  if (parseResult.goal.destination) console.log(`   Destination: ${parseResult.goal.destination}`);
  if (parseResult.goal.date) console.log(`   Date: ${parseResult.goal.date}`);
  if (parseResult.ambiguities.length > 0) {
    console.log("   ⚠  Ambiguities:", parseResult.ambiguities);
  }
  console.log(`   Success criteria: ${parseResult.goal.successCriteria}`);
  console.log();

  // Step 2: Create plan
  console.log("🗺  Step 2: Generating execution plan...");
  const planner = new Planner();
  const plan = planner.createPlan(parseResult.goal);

  for (let i = 0; i < plan.steps.length; i++) {
    console.log(`   ${i + 1}. ${plan.steps[i]}`);
  }
  console.log(`   Estimated actions: ${plan.estimatedActions}`);
  console.log();

  // Step 3: Execute via AgentLoop
  console.log("🚀 Step 3: Executing plan via AgentLoop...");
  console.log();

  const llm = new DemoLLMProvider();
  const browser = new DemoBrowserController();
  const observer = new DemoObserver();
  const safety = new SafetyGuard();
  const human = new DemoHumanInterface();

  const onProgress = (event: ProgressEvent) => {
    const icons: Record<string, string> = {
      planning: "📋", observing: "👁", deciding: "🧠", acting: "⚡",
      recovering: "🔄", human_assist: "🙋", complete: "✅", error: "❌",
    };
    console.log(`  ${icons[event.type] || "•"} [${event.stepIndex}] ${event.message}`);
  };

  const loop = new AgentLoop({
    llm,
    browser,
    observer,
    safety,
    human,
    config: { maxActions: 20, maxRetries: 3 },
    onProgress,
  });

  const result = await loop.run(parseResult.goal, {}, plan);

  console.log();
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  RESULT");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  Status:       ${result.success ? "✅ SUCCESS" : "❌ FAILED"}`);
  console.log(`  Actions:      ${result.actionsTaken}`);
  console.log(`  Final state:  ${result.finalState}`);
  console.log(`  Result:       ${result.result}`);
  console.log();

  // Session state summary
  const session = loop.getSessionState();
  if (session) {
    console.log("  Session Summary:");
    console.log(`  Duration:     ${session.updatedAt - session.startedAt}ms`);
    console.log(`  Steps:        ${session.history.length}`);
    console.log("  Trace:");
    for (const entry of session.history) {
      const status = entry.result.success ? "✓" : "✗";
      console.log(`    ${status} Step ${entry.step}: ${entry.action.type}`);
    }
  }
}

main().catch(console.error);
