import { readFile, readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { isNoise } from "./filter.js";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

// Harness-injected user records that appear only in transcripts (not in history.jsonl)
const TRANSCRIPT_NOISE_MARKERS = [
  "<task-notification>",
  "[Request interrupted",
];

function isTranscriptNoise(text: string): boolean {
  if (isNoise(text)) return true;
  return TRANSCRIPT_NOISE_MARKERS.some((m) => text.startsWith(m));
}

export function projectToSlug(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-");
}

function truncate(text: string, max: number): string {
  if (max > 0 && text.length > max) return text.slice(0, max) + "…(truncated)";
  return text;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "??-?? ??:??";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// extract-session
// ---------------------------------------------------------------------------

export interface ExtractSessionOptions {
  project?: string;
  maxCharsUser?: number;
  maxCharsAssistant?: number;
  includeTools?: boolean;
}

export interface TranscriptMessage {
  role: "user" | "assistant";
  timestamp: string;
  text: string;
}

export interface TranscriptResult {
  sessionId: string;
  cwd: string;
  gitBranch: string;
  startTime: string;
  endTime: string;
  userCount: number;
  assistantCount: number;
  totalLines: number;
  rawBytes: number;
  messages: TranscriptMessage[];
}

export function parseTranscriptLines(
  lines: string[],
  options: ExtractSessionOptions = {},
): TranscriptResult {
  const { maxCharsUser = 2000, maxCharsAssistant = 500, includeTools = false } = options;

  const result: TranscriptResult = {
    sessionId: "",
    cwd: "",
    gitBranch: "",
    startTime: "",
    endTime: "",
    userCount: 0,
    assistantCount: 0,
    totalLines: 0,
    rawBytes: 0,
    messages: [],
  };

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    result.totalLines++;

    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }

    if (rec.isSidechain === true) continue;
    if (rec.type !== "user" && rec.type !== "assistant") continue;

    if (!result.sessionId && rec.sessionId) result.sessionId = rec.sessionId;
    if (!result.cwd && rec.cwd) result.cwd = rec.cwd;
    if (!result.gitBranch && rec.gitBranch) result.gitBranch = rec.gitBranch;

    const timestamp: string = rec.timestamp ?? "";
    if (timestamp) {
      if (!result.startTime || timestamp < result.startTime) result.startTime = timestamp;
      if (!result.endTime || timestamp > result.endTime) result.endTime = timestamp;
    }

    if (rec.type === "user") {
      // Human input is usually string content. Array content is tool_results,
      // except text items: plugin hooks (e.g. codex) rewrite the typed prompt into
      // an isMeta record whose text embeds the original after "Raw user request:".
      const content = rec.message?.content;
      let text = "";
      if (typeof content === "string") {
        if (rec.isMeta === true) continue;
        text = content.trim();
      } else if (Array.isArray(content)) {
        text = content
          .filter((i) => i?.type === "text" && typeof i.text === "string")
          .map((i) => {
            const marker = "Raw user request:";
            const idx = i.text.indexOf(marker);
            return (idx >= 0 ? i.text.slice(idx + marker.length) : i.text).trim();
          })
          .filter((t) => t && !isTranscriptNoise(t))
          .join("\n");
      }
      if (!text || isTranscriptNoise(text)) continue;
      result.userCount++;
      result.messages.push({ role: "user", timestamp, text: truncate(text, maxCharsUser) });
      continue;
    }

    // assistant: keep text blocks, drop thinking, aggregate tool_use only when asked
    const items: any[] = Array.isArray(rec.message?.content) ? rec.message.content : [];
    const text = items
      .filter((i) => i?.type === "text" && typeof i.text === "string")
      .map((i) => i.text)
      .join("\n")
      .trim();

    let toolsLine = "";
    if (includeTools) {
      const counts = new Map<string, number>();
      for (const i of items) {
        if (i?.type === "tool_use" && typeof i.name === "string") {
          counts.set(i.name, (counts.get(i.name) ?? 0) + 1);
        }
      }
      if (counts.size > 0) {
        toolsLine = `[tools: ${[...counts.entries()].map(([n, c]) => `${n} x${c}`).join(", ")}]`;
      }
    }

    const parts = [text ? truncate(text, maxCharsAssistant) : "", toolsLine].filter(Boolean);
    if (parts.length === 0) continue;
    result.assistantCount++;
    result.messages.push({ role: "assistant", timestamp, text: parts.join("\n") });
  }

  return result;
}

async function resolveSessionPath(target: string, project?: string): Promise<string> {
  if (target.includes("/") || target.endsWith(".jsonl")) return target;

  const dirs = await listProjectDirs(project);
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    const hit = entries.find((e) => e.endsWith(".jsonl") && e.startsWith(target));
    if (hit) return join(dir, hit);
  }
  throw new Error(`Session not found: ${target} (searched under ${PROJECTS_DIR})`);
}

export async function extractSession(
  target: string,
  options: ExtractSessionOptions = {},
): Promise<TranscriptResult> {
  const path = await resolveSessionPath(target, options.project);
  const raw = await readFile(path, "utf-8");
  const result = parseTranscriptLines(raw.split("\n"), options);
  result.rawBytes = Buffer.byteLength(raw, "utf-8");
  if (!result.sessionId) result.sessionId = basename(path, ".jsonl");
  return result;
}

export function formatTranscript(result: TranscriptResult): string {
  const out: string[] = [];
  const projectShort = result.cwd.replace(/\/$/, "").split("/").pop() ?? result.cwd;
  const period = result.startTime
    ? `${formatTime(result.startTime)} 〜 ${formatTime(result.endTime)}`
    : "unknown period";

  out.push(`# session ${result.sessionId.slice(0, 8)} | project: ${projectShort} | branch: ${result.gitBranch || "-"} | ${period}`);
  const extractedBytes = Buffer.byteLength(result.messages.map((m) => m.text).join("\n"), "utf-8");
  out.push(`# ${result.userCount} user / ${result.assistantCount} assistant messages, ${formatBytes(result.rawBytes)} → ${formatBytes(extractedBytes)} extracted`);
  out.push("");

  for (const m of result.messages) {
    const time = m.timestamp ? formatTime(m.timestamp).slice(5) : "??:??";
    out.push(`[${time}] ${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.text}`);
  }

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// list-sessions
// ---------------------------------------------------------------------------

export interface ListSessionsOptions {
  project?: string;
  days?: number;
  ids?: string[];
}

export interface SessionInfo {
  id: string;
  path: string;
  sizeBytes: number;
  mtime: Date;
  userMessageCount: number;
  firstPrompt: string;
}

async function listProjectDirs(project?: string): Promise<string[]> {
  const needle = project ? projectToSlug(project) : projectToSlug(process.cwd());
  let entries: string[];
  try {
    entries = await readdir(PROJECTS_DIR);
  } catch {
    return [];
  }
  return entries.filter((e) => e.includes(needle)).map((e) => join(PROJECTS_DIR, e));
}

export async function listSessions(options: ListSessionsOptions = {}): Promise<SessionInfo[]> {
  const { days = 30, ids } = options;
  const cutoff = Date.now() - days * 86_400_000;
  const sessions: SessionInfo[] = [];

  for (const dir of await listProjectDirs(options.project)) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const id = basename(entry, ".jsonl");
      if (ids && ids.length > 0 && !ids.some((p) => id.startsWith(p))) continue;

      const path = join(dir, entry);
      let info;
      try {
        info = await stat(path);
      } catch {
        continue;
      }
      if (!info.isFile() || info.mtimeMs < cutoff) continue;

      let raw: string;
      try {
        raw = await readFile(path, "utf-8");
      } catch {
        continue;
      }
      const parsed = parseTranscriptLines(raw.split("\n"), { maxCharsUser: 100 });

      sessions.push({
        id,
        path,
        sizeBytes: info.size,
        mtime: info.mtime,
        userMessageCount: parsed.userCount,
        firstPrompt: parsed.messages.find((m) => m.role === "user")?.text ?? "",
      });
    }
  }

  return sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

export function formatSessionList(sessions: SessionInfo[], options: ListSessionsOptions = {}): string {
  const { days = 30, project } = options;
  const out: string[] = [];

  out.push(`# Sessions: ${sessions.length} found (last ${days} days)`);
  if (project) out.push(`# Project filter: ${project}`);
  out.push("");

  for (const s of sessions) {
    out.push(`- ${s.id.slice(0, 8)} | ${formatTime(s.mtime.toISOString())} | ${formatBytes(s.sizeBytes)} | ${s.userMessageCount} user msgs | ${s.path}`);
    if (s.firstPrompt) out.push(`  first: "${s.firstPrompt.replace(/\s*\n\s*/g, " ")}"`);
  }

  return out.join("\n");
}
