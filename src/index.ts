#!/usr/bin/env node

import { filterHistory, formatResult, type FilterOptions } from "./filter.js";

function printUsage(): void {
  console.log(`hargen — Harness generator for Claude Code

Usage:
  hargen extract-prompts [options]    Extract user prompts from Claude history

Options:
  --days <n>         Look back N days (default: 30)
  --project <name>   Filter by project name (partial match)
  --max-chars <n>    Max chars per prompt, 0=unlimited (default: 200)
  --help             Show this help
`);
}

function parseArgs(args: string[]): { command: string; options: FilterOptions } {
  const command = args[0] ?? "help";
  const options: FilterOptions = {};

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--days":
        options.days = parseInt(args[++i], 10);
        break;
      case "--project":
        options.project = args[++i];
        break;
      case "--max-chars":
        options.maxChars = parseInt(args[++i], 10);
        break;
      case "--help":
        return { command: "help", options };
    }
  }

  return { command, options };
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (command === "help" || command === "--help") {
    printUsage();
    return;
  }

  if (command === "extract-prompts") {
    const result = await filterHistory(options);
    console.log(formatResult(result, options));
    return;
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exitCode = 1;
}

main();
