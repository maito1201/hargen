import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const HISTORY_FILE = join(homedir(), ".claude", "history.jsonl");

interface HistoryEntry {
  display: string;
  timestamp: number;
  project: string;
  sessionId: string;
}

interface Prompt {
  text: string;
  timestamp: number;
  project: string;
}

// Slash commands that are noise
const COMMAND_NOISE = new Set([
  "/clear", "/resume", "/status", "/usage", "/plugin",
  "/init", "/mcp", "/compact", "/new", "/config",
  "/help", "/pr", "/review", "/model", "/logout",
  "/reload-plugins", "/skills",
]);

// System-injected content markers
const SYSTEM_MARKERS = [
  "<command-message>",
  "<command-name>",
  "<local-command-caveat>",
  "<local-command-stdout>",
  "<system-reminder>",
  "<command-args>",
  "This session is being continued from",
];

function isNoise(text: string): boolean {
  if (text.length < 5) return true;
  if (COMMAND_NOISE.has(text)) return true;
  if (SYSTEM_MARKERS.some((m) => text.startsWith(m))) return true;
  if (text === "[Pasted text #1]") return true;
  return false;
}

export interface FilterOptions {
  days?: number;
  project?: string;
  maxChars?: number;
}

export interface FilterResult {
  totalEntries: number;
  filteredCount: number;
  sessions: Map<string, { project: string; prompts: Prompt[] }>;
}

export async function filterHistory(options: FilterOptions = {}): Promise<FilterResult> {
  const { days = 30, project, maxChars = 200 } = options;

  let raw: string;
  try {
    raw = await readFile(HISTORY_FILE, "utf-8");
  } catch {
    return { totalEntries: 0, filteredCount: 0, sessions: new Map() };
  }

  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const cutoff = Date.now() - days * 86_400_000;
  const sessions = new Map<string, { project: string; prompts: Prompt[] }>();
  let filteredCount = 0;

  for (const line of lines) {
    let entry: HistoryEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.timestamp < cutoff) continue;
    if (project && !entry.project.includes(project)) continue;

    const text = entry.display?.trim();
    if (!text || isNoise(text)) continue;
    if (maxChars > 0 && text.length > maxChars) continue;

    filteredCount++;
    const sessionId = entry.sessionId;

    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { project: entry.project, prompts: [] });
    }
    sessions.get(sessionId)!.prompts.push({
      text,
      timestamp: entry.timestamp,
      project: entry.project,
    });
  }

  return { totalEntries: lines.length, filteredCount, sessions };
}

export function formatResult(result: FilterResult, options: FilterOptions = {}): string {
  const { days = 30, maxChars = 200, project } = options;
  const out: string[] = [];

  out.push(`# Filtered prompts: ${result.filteredCount} / ${result.totalEntries} total entries`);
  out.push(`# Period: last ${days} days | Max chars: ${maxChars}`);
  if (project) out.push(`# Project filter: ${project}`);
  out.push("");

  // Sort sessions by most recent prompt
  const sorted = [...result.sessions.entries()].sort(
    (a, b) => {
      const aMax = Math.max(...a[1].prompts.map((p) => p.timestamp));
      const bMax = Math.max(...b[1].prompts.map((p) => p.timestamp));
      return bMax - aMax;
    }
  );

  for (const [sessionId, { project: proj, prompts }] of sorted) {
    const projectShort = proj.replace(/\/$/, "").split("/").pop() ?? proj;
    out.push(`## session:${sessionId.slice(0, 8)} (${projectShort})`);
    const sortedPrompts = [...prompts].sort((a, b) => a.timestamp - b.timestamp);
    for (const p of sortedPrompts) {
      out.push(`- ${p.text}`);
    }
    out.push("");
  }

  return out.join("\n");
}
