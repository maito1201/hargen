#!/usr/bin/env node

import { filterHistory, formatResult, type FilterOptions } from "./filter.js";
import {
  listSessions,
  formatSessionList,
  extractSession,
  formatTranscript,
  type ListSessionsOptions,
  type ExtractSessionOptions,
} from "./transcript.js";

function printUsage(): void {
  console.log(`hargen — Harness generator for Claude Code

Usage:
  hargen extract-prompts [options]           Extract user prompts from Claude history
  hargen list-sessions [options]             List session transcripts for a project
  hargen extract-session <id|path> [options] Extract a readable digest from a session transcript

Options (extract-prompts):
  --days <n>                Look back N days (default: 30)
  --project <name>          Filter by project name (partial match)
  --max-chars <n>           Max chars per prompt, 0=unlimited (default: 200)

Options (list-sessions):
  --days <n>                Look back N days by file mtime (default: 30)
  --project <name>          Project name (partial match, default: cwd)
  --ids <id1,id2,...>       Filter by session ID prefixes

Options (extract-session):
  --project <name>          Project to search when <id> is a session ID prefix
  --max-chars-user <n>      Truncate user messages, 0=unlimited (default: 2000)
  --max-chars-assistant <n> Truncate assistant messages, 0=unlimited (default: 500)
  --include-tools           Include aggregated tool usage lines

  --help                    Show this help
`);
}

interface ParsedArgs {
  command: string;
  positional: string[];
  options: FilterOptions & ListSessionsOptions & ExtractSessionOptions;
}

function parseArgs(args: string[]): ParsedArgs {
  const command = args[0] ?? "help";
  const positional: string[] = [];
  const options: ParsedArgs["options"] = {};

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
      case "--ids":
        options.ids = (args[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--max-chars-user":
        options.maxCharsUser = parseInt(args[++i], 10);
        break;
      case "--max-chars-assistant":
        options.maxCharsAssistant = parseInt(args[++i], 10);
        break;
      case "--include-tools":
        options.includeTools = true;
        break;
      case "--help":
        return { command: "help", positional, options };
      default:
        positional.push(args[i]);
    }
  }

  return { command, positional, options };
}

async function main(): Promise<void> {
  const { command, positional, options } = parseArgs(process.argv.slice(2));

  if (command === "help" || command === "--help") {
    printUsage();
    return;
  }

  if (command === "extract-prompts") {
    const result = await filterHistory(options);
    console.log(formatResult(result, options));
    return;
  }

  if (command === "list-sessions") {
    const sessions = await listSessions(options);
    console.log(formatSessionList(sessions, options));
    return;
  }

  if (command === "extract-session") {
    const target = positional[0];
    if (!target) {
      console.error("extract-session requires a session ID or a .jsonl path");
      process.exitCode = 1;
      return;
    }
    const result = await extractSession(target, options);
    console.log(formatTranscript(result));
    return;
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exitCode = 1;
}

main();
