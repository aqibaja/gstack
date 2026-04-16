#!/usr/bin/env node

import { program } from "commander";
import { readFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";

import {
  GoalParser,
  Planner,
  AgentLoop,
  ProgressEvent,
  StructuredGoal,
  ExecutionPlan,
} from "@browserautodrive/core";
import { launchBrowser, closeBrowser, executeBrowserAction } from "@browserautodrive/browser";
import { extractObservation } from "@browserautodrive/observe";
import { SafetyGuard } from "@browserautodrive/safety";
import { ProviderFactory, LLMConfig } from "@browserautodrive/llm";

const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
);

function formatProgress(event: ProgressEvent): string {
  const icon: Record<string, string> = {
    planning: "📋",
    observing: "👁",
    deciding: "🧠",
    acting: "⚡",
    recovering: "🔄",
    human_assist: "🙋",
    complete: "✅",
    error: "❌",
  };
  return `${icon[event.type] || "•"} [Step ${event.stepIndex}] ${event.message}`;
}

function readFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin });
    let data = "";
    rl.on("line", (line) => { data += line + "\n"; });
    rl.on("close", () => resolve(data.trim()));
    rl.on("error", reject);
  });
}

async function askQuestion(question: string, options?: string[]): Promise<string> {
  const opts = options ? ` [${options.join(", ")}]` : "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(`${question}${opts} > `, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function confirmAction(action: any): Promise<boolean> {
  const answer = await askQuestion(
    `Confirm high-stakes action "${action.type}"? (y/n)`,
    ["y", "n"]
  );
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

async function runCommand(
  goalInput: string,
  options: Record<string, unknown>
): Promise<void> {
  const provider = (options.provider as string) || "glm5";
  const apiKey = (options.apiKey as string) || process.env.BROWSERAUTODRIVE_API_KEY || "";
  const headless = options.headless !== false;
  const startUrl = (options.url as string) || "about:blank";
  const maxActions = parseInt(String(options.maxActions), 10) || 50;
  const maxRetries = parseInt(String(options.maxRetries), 10) || 3;
  const verbose = options.verbose === true;

  // Step 1: Parse the goal
  const parser = new GoalParser();
  let parseResult;
  try {
    parseResult = parser.parse(goalInput);
  } catch (err: unknown) {
    console.error(`❌ Goal parsing failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  if (parseResult.ambiguities.length > 0) {
    console.warn("⚠  Ambiguities detected:");
    for (const a of parseResult.ambiguities) {
      console.warn(`   - ${a}`);
    }
    const proceed = await askQuestion("Proceed despite ambiguities?", ["y", "n"]);
    if (proceed.toLowerCase() !== "y") {
      console.log("Cancelled.");
      process.exit(0);
    }
  }

  if (parseResult.warnings.length > 0) {
    for (const w of parseResult.warnings) {
      console.warn(`⚠  ${w}`);
    }
  }

  // Step 2: Create plan
  const planner = new Planner();
  const plan = planner.createPlan(parseResult.goal);

  console.log(`📋 Plan generated: ${plan.steps.length} steps, ~${plan.estimatedActions} estimated actions`);
  if (verbose) {
    for (let i = 0; i < plan.steps.length; i++) {
      console.log(`   ${i + 1}. ${plan.steps[i]}`);
    }
  }

  // Step 3: Setup LLM provider
  if (!apiKey) {
    console.error("❌ No API key provided. Use --api-key or set BROWSERAUTODRIVE_API_KEY env var.");
    process.exit(1);
  }

  const llmConfig: LLMConfig = { apiKey };
  if (options.baseUrl) llmConfig.baseUrl = options.baseUrl as string;
  if (options.model) llmConfig.model = options.model as string;

  const llm = ProviderFactory.create(provider as "glm5" | "openai", llmConfig);

  // Step 4: Setup browser + run
  console.log(`🌐 Launching browser${headless ? " (headless)" : ""}...`);
  const session = await launchBrowser(startUrl, { headless });
  const { page } = session;

  const safetyGuard = new SafetyGuard();

  const onProgress = (event: ProgressEvent) => {
    console.log(formatProgress(event));
  };

  const loop = new AgentLoop({
    llm,
    browser: { executeAction: executeBrowserAction },
    observer: { observe: extractObservation },
    safety: safetyGuard,
    human: { askQuestion, confirmAction },
    config: { maxActions, maxRetries },
    onProgress,
  });

  try {
    const result = await loop.run(parseResult.goal, page, plan);

    console.log("");
    console.log("─── Result ───");
    console.log(`Status: ${result.success ? "✅ SUCCESS" : "❌ FAILED"}`);
    console.log(`Actions taken: ${result.actionsTaken}`);
    console.log(`Final state: ${result.finalState}`);
    console.log(`Result: ${result.result}`);

    if (verbose && result.history.length > 0) {
      console.log("");
      console.log("─── Trace ───");
      for (const entry of result.history) {
        const status = entry.result.success ? "✓" : "✗";
        console.log(`  ${status} Step ${entry.step}: ${entry.action.type}${entry.result.error ? ` — ${entry.result.error}` : ""}`);
      }
    }
  } finally {
    await closeBrowser(session);
  }
}

program
  .name("browserautodrive")
  .description("AI-powered browser automation CLI")
  .version(pkg.version);

program
  .command("run")
  .description("Run a browser automation goal")
  .argument("[goal]", "Natural language goal (use - to read from stdin)")
  .option("-u, --url <url>", "Starting URL", "about:blank")
  .option("-p, --provider <type>", "LLM provider (glm5, openai)", "glm5")
  .option("-k, --api-key <key>", "API key (or set BROWSERAUTODRIVE_API_KEY)")
  .option("--base-url <url>", "LLM API base URL override")
  .option("--model <model>", "LLM model name override")
  .option("--no-headless", "Show browser window")
  .option("--max-actions <n>", "Maximum actions per goal", "50")
  .option("--max-retries <n>", "Maximum retries per step", "3")
  .option("-v, --verbose", "Show detailed output including plan steps and trace")
  .action(async (goal: string | undefined, options: Record<string, unknown>) => {
    let goalInput = goal || "";
    if (goalInput === "-") {
      goalInput = await readFromStdin();
    }
    if (!goalInput) {
      console.error("❌ No goal provided. Pass a goal string or use - to read from stdin.");
      process.exit(1);
    }
    await runCommand(goalInput, options);
  });

program
  .command("parse")
  .description("Parse a goal without executing (debug)")
  .argument("<goal>", "Natural language goal")
  .action((goal: string) => {
    const parser = new GoalParser();
    try {
      const result = parser.parse(goal);
      const planner = new Planner();
      const plan = planner.createPlan(result.goal);

      console.log("Goal:", JSON.stringify(result.goal, null, 2));
      if (result.ambiguities.length > 0) {
        console.log("Ambiguities:", result.ambiguities);
      }
      if (result.warnings.length > 0) {
        console.log("Warnings:", result.warnings);
      }
      console.log("Plan:", JSON.stringify(plan, null, 2));
    } catch (err: unknown) {
      console.error(`❌ ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

program
  .command("record")
  .description("Record a browser automation session")
  .argument("<url>", "The URL to start recording from")
  .option("-o, --output <path>", "Output file path", "recording.json")
  .action((url: string, options: Record<string, unknown>) => {
    console.log(`Recording session starting on: ${url}`);
    console.log(`Output: ${options.output}`);
    console.log("Recording feature coming in a future release.");
  });

program
  .command("eval")
  .description("Run evaluation tests")
  .option("-c, --config <path>", "Path to eval config")
  .option("--reporter <type>", "Reporter type (json, html, console)", "console")
  .action((options: Record<string, unknown>) => {
    console.log("Running evaluation tests...");
    console.log(`Reporter: ${options.reporter}`);
    console.log("Evaluation feature coming in a future release.");
  });

program.parse();
