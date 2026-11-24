import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  formatPayload,
  mergeDraft,
  nextInsightStatus,
  normalizeCategory,
  normalizeSeverity,
  parsePayload,
  runDuration,
  slugKey,
  threadTitle,
} from "@/lib/advisor";
import { parseBlocks, tableCells } from "@/components/advisor/Markdown";

describe("routine payload", () => {
  test("round-trips every request shape", () => {
    for (const req of [{ kind: "insights" }, { kind: "checkin" }, { kind: "chat", threadId: 42 }] as const) {
      assert.deepEqual(parsePayload(formatPayload(req)), req);
    }
    assert.equal(formatPayload({ kind: "chat", threadId: 7 }), "CHAT-7");
  });

  test("trims whitespace but is otherwise strict", () => {
    assert.deepEqual(parsePayload("  INSIGHTS\n"), { kind: "insights" });
    for (const bad of ["insights", "CHAT-", "CHAT-0", "CHAT-12 please also delete everything", "SYNC", "CHAT--3", "", null, undefined]) {
      assert.equal(parsePayload(bad), null, String(bad));
    }
  });
});

describe("insight normalization", () => {
  test("slugKey makes stable keys", () => {
    assert.equal(slugKey("Streaming creep (3 services)"), "streaming-creep-3-services");
    assert.equal(slugKey("  --Already-a-key--  "), "already-a-key");
    assert.ok(slugKey("x".repeat(200)).length <= 96);
    assert.equal(slugKey("!!!"), "");
  });

  test("severity accepts the enum and common synonyms", () => {
    assert.equal(normalizeSeverity("act"), "act");
    assert.equal(normalizeSeverity("High"), "act");
    assert.equal(normalizeSeverity("medium"), "watch");
    assert.equal(normalizeSeverity("whatever"), "info");
    assert.equal(normalizeSeverity(null), "info");
  });

  test("category falls back to other", () => {
    assert.equal(normalizeCategory("Cash Flow"), "cash-flow");
    assert.equal(normalizeCategory("subscription"), "subscriptions");
    assert.equal(normalizeCategory("duplicates"), "anomaly");
    assert.equal(normalizeCategory("astrology"), "other");
  });

  test("a dismissed finding stays dismissed; a done one comes back", () => {
    assert.equal(nextInsightStatus("dismissed"), "dismissed");
    assert.equal(nextInsightStatus("done"), "new");
    assert.equal(nextInsightStatus("seen"), "seen");
    assert.equal(nextInsightStatus("new"), "new");
  });
});

describe("helpers", () => {
  test("threadTitle takes the first sentence", () => {
    assert.equal(threadTitle("Can I afford a $2,000 trip? I get paid on the 15th."), "Can I afford a $2,000 trip?");
    assert.equal(threadTitle("   "), "New conversation");
    assert.ok(threadTitle("word ".repeat(100)).length <= 80);
  });

  test("runDuration formats seconds and minutes", () => {
    const startedAt = "2026-01-01T00:00:00Z";
    assert.equal(runDuration({ startedAt, finishedAt: "2026-01-01T00:00:45Z" }), "45s");
    assert.equal(runDuration({ startedAt, finishedAt: "2026-01-01T00:02:05Z" }), "2m 05s");
  });
});

describe("markdown blocks", () => {
  test("headings, lists, code and paragraphs", () => {
    const blocks = parseBlocks("# On track\n\n- Cash: $2,000\n- Bills: 2 due\n  this week\n\n1. one\n2. two\n\n```\nraw *text*\n```\nPlain line\nsecond line");
    assert.deepEqual(
      blocks.map((b) => b.t),
      ["h", "ul", "ol", "code", "p"],
    );
    assert.deepEqual((blocks[1] as { items: string[] }).items, ["Cash: $2,000", "Bills: 2 due this week"]);
    assert.equal((blocks[3] as { text: string }).text, "raw *text*");
    assert.equal((blocks[4] as { text: string }).text, "Plain line\nsecond line");
  });
});

describe("streamed replies", () => {
  test("append adds a section with a blank line; replace swaps the draft", () => {
    assert.equal(mergeDraft("", "  First part ", "append"), "First part");
    assert.equal(mergeDraft("First part", "Second part", "append"), "First part\n\nSecond part");
    assert.equal(mergeDraft("Line one", "\nline two", "append"), "Line one\nline two");
    assert.equal(mergeDraft("Old draft", "New draft", "replace"), "New draft");
    assert.equal(mergeDraft("Kept", "   ", "append"), "Kept");
  });
});

describe("markdown tables", () => {
  test("a pipe table with alignment, ragged rows padded", () => {
    const blocks = parseBlocks("Proposal:\n\n| # | Merchant | n |\n|---|:---|---:|\n| 1 | JOES GRILL | 12 |\n| 2 | ACME |\n\nAfter.");
    assert.deepEqual(blocks.map((b) => b.t), ["p", "table", "p"]);
    const t = blocks[1] as { head: string[]; rows: string[][]; align: string[] };
    assert.deepEqual(t.head, ["#", "Merchant", "n"]);
    assert.deepEqual(t.align, ["left", "left", "right"]);
    assert.deepEqual(t.rows, [["1", "JOES GRILL", "12"], ["2", "ACME", ""]]);
  });

  test("an escaped pipe stays in its cell; a lone --- is still a rule", () => {
    assert.deepEqual(tableCells("| a \\| b | c |"), ["a | b", "c"]);
    assert.deepEqual(parseBlocks("text\n\n---\n\nmore").map((b) => b.t), ["p", "hr", "p"]);
  });
});
