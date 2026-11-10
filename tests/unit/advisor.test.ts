import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  formatPayload,
  nextInsightStatus,
  normalizeCategory,
  normalizeSeverity,
  parsePayload,
  runDuration,
  slugKey,
  threadTitle,
} from "@/lib/advisor";
import { parseBlocks } from "@/components/advisor/Markdown";

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
