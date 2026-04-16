#!/usr/bin/env node

import { program } from 'commander';
import { readFileSync } from 'fs';
import { join } from 'path';

const pkg = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

program
  .name('browserautodrive')
  .description('AI-powered browser automation CLI')
  .version(pkg.version);

program
  .command('run')
  .description('Run a browser automation task')
  .argument('<url>', 'The URL to automate')
  .option('-c, --config <path>', 'Path to config file', 'browserautodrive.config.json')
  .option('-o, --output <path>', 'Output file path')
  .option('--headless', 'Run in headless mode', true)
  .action((url: string, options: Record<string, unknown>) => {
    console.log(`Running browser automation on: ${url}`);
    console.log(`Config: ${options.config}`);
    console.log(`Headless: ${options.headless}`);
    console.log('BrowserAutoDrive is not fully configured yet.');
  });

program
  .command('record')
  .description('Record a browser automation session')
  .argument('<url>', 'The URL to start recording from')
  .option('-o, --output <path>', 'Output file path', 'recording.json')
  .action((url: string, options: Record<string, unknown>) => {
    console.log(`Recording session starting on: ${url}`);
    console.log(`Output: ${options.output}`);
    console.log('Recording feature is not fully configured yet.');
  });

program
  .command('eval')
  .description('Run evaluation tests')
  .option('-c, --config <path>', 'Path to eval config')
  .option('--reporter <type>', 'Reporter type (json, html, console)', 'console')
  .action((options: Record<string, unknown>) => {
    console.log('Running evaluation tests...');
    console.log(`Reporter: ${options.reporter}`);
    console.log('Evaluation feature is not fully configured yet.');
  });

program.parse();
