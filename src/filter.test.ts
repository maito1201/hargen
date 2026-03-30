import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterHistory, formatResult } from "./filter.js";

describe("filterHistory", () => {
  it("reads history.jsonl and returns results", async () => {
    const result = await filterHistory({ days: 7 });
    assert.ok(result.totalEntries > 0, "history.jsonl should have entries");
  });

  it("filters by project name", async () => {
    const result = await filterHistory({ project: "notahotel-api", days: 30 });
    for (const [, { project }] of result.sessions) {
      assert.ok(project.includes("notahotel-api"), `Expected project to contain 'notahotel-api', got '${project}'`);
    }
  });

  it("filters by days", async () => {
    const all = await filterHistory({ days: 365 });
    const recent = await filterHistory({ days: 1 });
    assert.ok(all.filteredCount >= recent.filteredCount, "365 days should have >= 1 day results");
  });

  it("filters out noise commands", async () => {
    const result = await filterHistory({ days: 30 });
    for (const [, { prompts }] of result.sessions) {
      for (const p of prompts) {
        assert.ok(p.text !== "/clear", "Should not contain /clear");
        assert.ok(p.text !== "/compact", "Should not contain /compact");
        assert.ok(!p.text.startsWith("<command-name>"), "Should not contain system tags");
      }
    }
  });

  it("respects maxChars filter", async () => {
    const result = await filterHistory({ days: 30, maxChars: 50 });
    for (const [, { prompts }] of result.sessions) {
      for (const p of prompts) {
        assert.ok(p.text.length <= 50, `Prompt too long: ${p.text.length} chars`);
      }
    }
  });
});

describe("formatResult", () => {
  it("produces text output with header", async () => {
    const result = await filterHistory({ days: 7 });
    const output = formatResult(result, { days: 7 });
    assert.ok(output.startsWith("# Filtered prompts:"), "Should start with header");
    assert.ok(output.includes("last 7 days"), "Should mention days");
  });

  it("groups by session", async () => {
    const result = await filterHistory({ days: 7 });
    const output = formatResult(result, { days: 7 });
    if (result.sessions.size > 0) {
      assert.ok(output.includes("## session:"), "Should contain session headers");
    }
  });
});
