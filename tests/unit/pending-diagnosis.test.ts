import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { diagnosePending, findCandidates, type AccountFeed, type PendingSubject } from "@/server/lib/pending-diagnosis";
import type { MatchSide } from "@/server/lib/pending-match";

// Illustrative values only (see CLAUDE.md "Personal data").
const TODAY = "2026-11-10";

const pending = (p: Partial<PendingSubject> = {}): PendingSubject => ({
  id: 1,
  txnDate: "2026-10-01",
  amount: 20,
  direction: "Debit",
  description: "CORNER CAFE #12",
  accountNumber: "1111",
  source: "provider-a",
  synced: true,
  ...p,
});

const posted = (p: Partial<MatchSide> & Pick<MatchSide, "id">): MatchSide => ({
  accountNumber: "1111",
  txnDate: "2026-10-03",
  amount: 20,
  direction: "Debit",
  description: "CORNER CAFE",
  ...p,
});

const feed = (f: Partial<AccountFeed> = {}): AccountFeed => ({
  provider: "provider-b",
  active: true,
  inactiveReason: null,
  coverageFrom: "2026-09-01",
  ...f,
});

const run = (over: Partial<Parameters<typeof diagnosePending>[0]> = {}) =>
  diagnosePending({ pending: pending(), today: TODAY, feed: feed(), pendingExpiryDays: 7, posted: [], hasMatch: false, ...over });

describe("stuck detection", () => {
  test("a synced row whose account is now fed by another provider is orphaned", () => {
    const d = run();
    assert.equal(d.stuck, true);
    assert.equal(d.reason, "orphaned");
    assert.match(d.why!, /no longer feeds this account/);
  });

  test("a synced row with no feed at all is orphaned", () => {
    assert.equal(run({ feed: null }).reason, "orphaned");
  });

  test("a synced row its own live feed still tracks is not stuck", () => {
    const d = run({ pending: pending({ txnDate: "2026-11-05", source: "provider-b" }) });
    assert.equal(d.stuck, false);
    assert.equal(d.lean, null);
  });

  test("own feed paused past the expiry window → feed-off", () => {
    const d = run({ pending: pending({ source: "provider-b" }), feed: feed({ active: false, inactiveReason: "paused" }) });
    assert.equal(d.reason, "feed-off");
    assert.match(d.why!, /paused/);
  });

  test("own live feed, pending far past expiry → overdue", () => {
    assert.equal(run({ pending: pending({ source: "provider-b" }) }).reason, "overdue");
  });

  test("hand-entered: stuck only once past the match window with no twin", () => {
    const hand = pending({ synced: false, source: "manual" });
    assert.equal(run({ pending: hand }).reason, "overdue");
    assert.equal(run({ pending: hand, hasMatch: true }).stuck, false);
    assert.equal(run({ pending: { ...hand, txnDate: "2026-11-05" } }).stuck, false);
  });
});

describe("evidence and lean", () => {
  test("an exact-amount twin under a different name leans posted (cross-provider naming)", () => {
    const d = run({ posted: [posted({ id: 9, description: "Corner Cafe" })] });
    assert.equal(d.lean, "posted");
    assert.equal(d.candidates[0].id, 9);
    assert.match(d.candidates[0].evidence, /exact amount/);
  });

  test("a grown amount is offered with the tip spelled out", () => {
    const [c] = findCandidates(pending(), [posted({ id: 9, amount: 24 })]);
    assert.equal(c.amountDiff, 4);
    assert.match(c.evidence, /\+\$4\.00 \(20%\) — a tip\?/);
  });

  test("candidates on another account or direction are never offered", () => {
    assert.equal(findCandidates(pending(), [posted({ id: 9, accountNumber: "2222" }), posted({ id: 10, direction: "Credit" })]).length, 0);
  });

  test("dismissed pairs are not offered again", () => {
    assert.equal(findCandidates(pending(), [posted({ id: 9 })], new Set(["1:9"])).length, 0);
  });

  test("a tiny charge with nothing posted after it, fully covered, leans hold", () => {
    const d = run({ pending: pending({ amount: 1, description: "EXAMPLE APP VERIFY" }) });
    assert.equal(d.lean, "hold");
    assert.ok(d.signals.some((s) => s.points === "hold" && /verification/.test(s.text)));
  });

  test("a gas-pump hold with no twin leans hold", () => {
    const d = run({ pending: pending({ amount: 100, description: "EXAMPLE FUEL 0042" }) });
    assert.equal(d.lean, "hold");
  });

  test("the new feed's history starting after the charge is flagged — no match proves nothing", () => {
    const d = run({ feed: feed({ coverageFrom: "2026-10-05" }) });
    assert.ok(d.signals.some((s) => s.points === "posted" && /history for this account starts 2026-10-05/.test(s.text)));
    // A coverage gap alone can't call it either way.
    assert.notEqual(d.lean, "hold");
  });

  test("a verification-sized charge still leans hold despite a coverage gap", () => {
    const d = run({ pending: pending({ amount: 1.5 }), feed: feed({ coverageFrom: "2026-10-05" }) });
    assert.equal(d.lean, "hold");
  });

  test("still inside the settle window: says so instead of claiming it never posted", () => {
    const hand = pending({ synced: false, source: "manual", txnDate: "2026-10-28" });
    // 13 days old → past HAND_OVERDUE_DAYS(10) but the window ends at +10 = 11-07 < today, so closed.
    const d = run({ pending: hand });
    assert.ok(d.signals.some((s) => /posted for a similar amount/.test(s.text)));
  });
});
