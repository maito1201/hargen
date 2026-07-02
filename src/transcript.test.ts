import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  projectToSlug,
  parseTranscriptLines,
  formatTranscript,
  listSessions,
} from "./transcript.js";

function userLine(content: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content },
    timestamp: "2026-07-01T10:00:00.000Z",
    sessionId: "abc12345-0000-0000-0000-000000000000",
    cwd: "/Users/test/project/sample",
    gitBranch: "main",
    ...extra,
  });
}

function assistantLine(content: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content },
    timestamp: "2026-07-01T10:01:00.000Z",
    sessionId: "abc12345-0000-0000-0000-000000000000",
    ...extra,
  });
}

describe("projectToSlug", () => {
  it("replaces non-alphanumeric chars with dashes", () => {
    assert.equal(projectToSlug("/Users/ito_masahiko/project/hargen"), "-Users-ito-masahiko-project-hargen");
  });
});

describe("parseTranscriptLines", () => {
  it("keeps string user messages and assistant text", () => {
    const result = parseTranscriptLines([
      userLine("テストを先に書いてほしいです"),
      assistantLine([{ type: "text", text: "了解しました。テストから書きます。" }]),
    ]);
    assert.equal(result.userCount, 1);
    assert.equal(result.assistantCount, 1);
    assert.equal(result.messages[0].role, "user");
    assert.equal(result.messages[1].role, "assistant");
    assert.equal(result.sessionId, "abc12345-0000-0000-0000-000000000000");
    assert.equal(result.cwd, "/Users/test/project/sample");
    assert.equal(result.gitBranch, "main");
  });

  it("excludes tool_result (array) user records", () => {
    const result = parseTranscriptLines([
      userLine([{ type: "tool_result", content: "file contents here" }]),
    ]);
    assert.equal(result.userCount, 0);
    assert.equal(result.messages.length, 0);
  });

  it("extracts plugin-wrapped prompts after 'Raw user request:'", () => {
    const wrapped = "Invoke the `codex:codex-rescue` subagent via the `Agent` tool.\n\nRaw user request:\nmigrationファイルは手編集せずツールで再生成してほしい";
    const result = parseTranscriptLines([
      userLine([{ type: "text", text: wrapped }], { isMeta: true }),
    ]);
    assert.equal(result.userCount, 1);
    assert.equal(result.messages[0].text, "migrationファイルは手編集せずツールで再生成してほしい");
  });

  it("excludes thinking and tool_use from assistant records", () => {
    const result = parseTranscriptLines([
      assistantLine([
        { type: "thinking", thinking: "secret reasoning" },
        { type: "text", text: "visible answer" },
        { type: "tool_use", name: "Bash", input: {} },
      ]),
      assistantLine([{ type: "tool_use", name: "Edit", input: {} }]),
    ]);
    assert.equal(result.assistantCount, 1);
    assert.equal(result.messages[0].text, "visible answer");
    assert.ok(!result.messages[0].text.includes("secret reasoning"));
  });

  it("aggregates tool_use only with includeTools", () => {
    const lines = [
      assistantLine([
        { type: "text", text: "running checks" },
        { type: "tool_use", name: "Bash", input: {} },
        { type: "tool_use", name: "Bash", input: {} },
        { type: "tool_use", name: "Edit", input: {} },
      ]),
    ];
    const withTools = parseTranscriptLines(lines, { includeTools: true });
    assert.ok(withTools.messages[0].text.includes("[tools: Bash x2, Edit x1]"));
    const withoutTools = parseTranscriptLines(lines);
    assert.ok(!withoutTools.messages[0].text.includes("[tools:"));
  });

  it("excludes sidechain records and meta string records", () => {
    const result = parseTranscriptLines([
      userLine("sidechain message content", { isSidechain: true }),
      userLine("meta message content here", { isMeta: true }),
      assistantLine([{ type: "text", text: "sidechain answer" }], { isSidechain: true }),
    ]);
    assert.equal(result.messages.length, 0);
  });

  it("truncates long messages instead of dropping them", () => {
    const long = "あ".repeat(3000);
    const result = parseTranscriptLines([userLine(long)], { maxCharsUser: 100 });
    assert.equal(result.userCount, 1);
    assert.ok(result.messages[0].text.length < 200);
    assert.ok(result.messages[0].text.endsWith("…(truncated)"));
  });

  it("excludes noise user prompts", () => {
    const result = parseTranscriptLines([
      userLine("/clear"),
      userLine("<system-reminder>injected</system-reminder>"),
      userLine("<task-notification>\n<task-id>abc</task-id>"),
      userLine("[Request interrupted by user]"),
      userLine("ok"),
    ]);
    assert.equal(result.userCount, 0);
  });

  it("skips broken JSON lines and unknown record types", () => {
    const result = parseTranscriptLines([
      "{ broken json",
      JSON.stringify({ type: "file-history-snapshot", snapshot: {} }),
      JSON.stringify({ type: "mode", mode: "plan" }),
      userLine("正常なユーザー発言です"),
    ]);
    assert.equal(result.userCount, 1);
    assert.equal(result.messages.length, 1);
  });

  it("tracks start and end time", () => {
    const result = parseTranscriptLines([
      userLine("最初の発言です", { timestamp: "2026-07-01T09:00:00.000Z" }),
      assistantLine([{ type: "text", text: "answer" }], { timestamp: "2026-07-01T12:00:00.000Z" }),
    ]);
    assert.equal(result.startTime, "2026-07-01T09:00:00.000Z");
    assert.equal(result.endTime, "2026-07-01T12:00:00.000Z");
  });
});

describe("formatTranscript", () => {
  it("produces header with counts and size, then chronological lines", () => {
    const result = parseTranscriptLines([
      userLine("テストを先に書いてほしいです"),
      assistantLine([{ type: "text", text: "了解しました" }]),
    ]);
    result.rawBytes = 1024 * 1024;
    const output = formatTranscript(result);
    assert.ok(output.startsWith("# session abc12345 | project: sample | branch: main |"));
    assert.ok(output.includes("1 user / 1 assistant messages"));
    assert.ok(output.includes("1.0MB →"));
    assert.ok(output.includes("USER: テストを先に書いてほしいです"));
    assert.ok(output.includes("ASSISTANT: 了解しました"));
  });
});

describe("listSessions (smoke)", () => {
  it("returns sessions sorted by mtime without throwing", async () => {
    const sessions = await listSessions({ days: 365 });
    for (let i = 1; i < sessions.length; i++) {
      assert.ok(sessions[i - 1].mtime.getTime() >= sessions[i].mtime.getTime(), "should be sorted desc");
    }
    for (const s of sessions) {
      assert.ok(s.path.endsWith(".jsonl"));
      assert.ok(s.sizeBytes > 0);
    }
  });
});
