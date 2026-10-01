import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  defaultSyncFrom,
  hasUserEdits,
  pendingDateFits,
  queryRange,
  reconcile,
  snapshotOf,
  type ExistingOtherRow,
  type ExistingSyncedRow,
} from "@/server/lib/sync/reconcile";
import type { ProviderTransaction } from "@/server/lib/sync/provider";

const TODAY = "2026-09-20";

function fetched(p: Partial<ProviderTransaction> & { externalId: string }): ProviderTransaction {
  return {
    externalAccountId: "acc_1",
    txnDate: "2026-09-18",
    description: "COFFEE",
    amount: 4.5,
    direction: "Debit",
    status: "posted",
    rawCategory: null,
    kind: null,
    counterparty: null,
    runningBalance: null,
    raw: null,
    ...p,
  };
}

// Unless a test says otherwise, the provider last sent exactly what is stored (no hand edits).
function synced(p: Partial<ExistingSyncedRow> & { id: number; externalId: string }): ExistingSyncedRow {
  const row = {
    txnDate: "2026-09-18",
    description: "COFFEE",
    amount: 4.5,
    direction: "Debit" as const,
    status: "posted" as const,
    category: null,
    categoryRuleId: null,
    notes: null,
    billId: null,
    billInstanceId: null,
    ...p,
  };
  return { lastSeen: "lastSeen" in p ? (p.lastSeen ?? null) : snapshotOf(row), ...row };
}

const opts = { today: TODAY, pendingExpiryDays: 7 };

describe("reconcile: inserts and unchanged", () => {
  test("new external ids are inserted; known identical rows are unchanged", () => {
    const plan = reconcile([fetched({ externalId: "t1" }), fetched({ externalId: "t2", description: "TEA" })], [synced({ id: 1, externalId: "t1" })], [], opts);
    assert.equal(plan.inserts.length, 1);
    assert.equal(plan.inserts[0].externalId, "t2");
    assert.equal(plan.unchanged, 1);
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.expirations.length, 0);
  });

  test("overlapping pages (same id twice) count once", () => {
    const plan = reconcile([fetched({ externalId: "t1" }), fetched({ externalId: "t1" })], [], [], opts);
    assert.equal(plan.inserts.length, 1);
  });
});

describe("reconcile: updates and promotion (D9)", () => {
  test("pending → posted with date + description change is one update, promoted, category re-run when rule-set", () => {
    const plan = reconcile(
      [fetched({ externalId: "t1", txnDate: "2026-09-19", description: "COFFEE SHOP #12", status: "posted" })],
      [synced({ id: 1, externalId: "t1", status: "pending", category: "Dining", categoryRuleId: 7 })],
      [],
      opts,
    );
    assert.equal(plan.updates.length, 1);
    const u = plan.updates[0];
    assert.deepEqual(u.changes, { txnDate: "2026-09-19", description: "COFFEE SHOP #12", status: "posted" });
    assert.equal(u.promoted, true);
    assert.equal(u.redoCategory, true);
    assert.equal(u.existingBillId, null);
  });

  test("a hand-set category is never re-run even when the description changes", () => {
    const plan = reconcile(
      [fetched({ externalId: "t1", description: "NEW TEXT" })],
      [synced({ id: 1, externalId: "t1", category: "Groceries", categoryRuleId: null })],
      [],
      opts,
    );
    assert.equal(plan.updates[0].redoCategory, false);
    assert.equal(plan.updates[0].promoted, false);
  });

  test("uncategorized row with a description change re-runs rules", () => {
    const plan = reconcile([fetched({ externalId: "t1", description: "NEW" })], [synced({ id: 1, externalId: "t1", category: null })], [], opts);
    assert.equal(plan.updates[0].redoCategory, true);
  });

  test("amount change below a cent is not an update", () => {
    const plan = reconcile([fetched({ externalId: "t1", amount: 4.504 })], [synced({ id: 1, externalId: "t1", amount: 4.5 })], [], opts);
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.unchanged, 1);
  });

  test("direction flip is an update", () => {
    const plan = reconcile([fetched({ externalId: "t1", direction: "Credit" })], [synced({ id: 1, externalId: "t1" })], [], opts);
    assert.deepEqual(plan.updates[0].changes, { direction: "Credit" });
  });
});

describe("reconcile: hand edits vs provider changes (D12, last-seen diffing)", () => {
  const seen = snapshotOf(fetched({ externalId: "t1", description: "COFFEE", txnDate: "2026-09-18", amount: 4.5 }));

  test("a hand-edited description survives when the provider did not change it", () => {
    const plan = reconcile([fetched({ externalId: "t1" })], [synced({ id: 1, externalId: "t1", description: "Coffee with Sam", lastSeen: seen })], [], opts);
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.unchanged, 1);
  });

  test("a provider change is applied even over a hand edit (bank wins on its own fields)", () => {
    const plan = reconcile(
      [fetched({ externalId: "t1", description: "COFFEE SHOP #12" })],
      [synced({ id: 1, externalId: "t1", description: "Coffee with Sam", lastSeen: seen })],
      [],
      opts,
    );
    assert.deepEqual(plan.updates[0].changes, { description: "COFFEE SHOP #12" });
  });

  test("hand-edited date/amount survive; a provider status change still lands", () => {
    const plan = reconcile(
      [fetched({ externalId: "t1", status: "pending" })],
      [synced({ id: 1, externalId: "t1", txnDate: "2026-09-17", amount: 4.6, status: "posted", lastSeen: seen })],
      [],
      opts,
    );
    assert.deepEqual(plan.updates[0].changes, { status: "pending" });
  });

  test("provider moves to what the user already set → no field change, but the snapshot refreshes", () => {
    const plan = reconcile(
      [fetched({ externalId: "t1", description: "Coffee with Sam" })],
      [synced({ id: 1, externalId: "t1", description: "Coffee with Sam", lastSeen: seen })],
      [],
      opts,
    );
    assert.equal(plan.updates.length, 1);
    assert.deepEqual(plan.updates[0].changes, {});
    assert.equal(plan.updates[0].promoted, false);
  });

  test("rows without a snapshot compare against stored values and get a snapshot written once", () => {
    const plan = reconcile([fetched({ externalId: "t1", description: "X" })], [synced({ id: 1, externalId: "t1", description: "Y", lastSeen: null })], [], opts);
    assert.deepEqual(plan.updates[0].changes, { description: "X" });
    const again = reconcile([fetched({ externalId: "t1" })], [synced({ id: 1, externalId: "t1", lastSeen: null })], [], opts);
    assert.equal(again.updates.length, 1);
    assert.deepEqual(again.updates[0].changes, {});
  });
});

describe("reconcile: soft duplicates against other sources (D4)", () => {
  const csvRow: ExistingOtherRow = { id: 50, txnDate: "2026-09-17", amount: 4.5, direction: "Debit", description: "COFFEE SHOP" };

  test("same amount + direction within ±2 days is skipped, not inserted", () => {
    const plan = reconcile([fetched({ externalId: "t1", txnDate: "2026-09-19" })], [], [csvRow], opts);
    assert.equal(plan.inserts.length, 0);
    assert.equal(plan.softDupes.length, 1);
    assert.equal(plan.softDupes[0].existingId, 50);
    assert.equal(plan.softDupes[0].existingDescription, "COFFEE SHOP");
  });

  test("3 days apart is NOT a duplicate", () => {
    const plan = reconcile([fetched({ externalId: "t1", txnDate: "2026-09-20" })], [], [csvRow], opts);
    assert.equal(plan.inserts.length, 1);
    assert.equal(plan.softDupes.length, 0);
  });

  test("different direction is not a duplicate", () => {
    const plan = reconcile([fetched({ externalId: "t1", txnDate: "2026-09-17", direction: "Credit" })], [], [csvRow], opts);
    assert.equal(plan.inserts.length, 1);
  });

  test("an existing row absorbs at most one fetched row", () => {
    const plan = reconcile([fetched({ externalId: "t1", txnDate: "2026-09-17" }), fetched({ externalId: "t2", txnDate: "2026-09-17" })], [], [csvRow], opts);
    assert.equal(plan.softDupes.length, 1);
    assert.equal(plan.inserts.length, 1);
    assert.equal(plan.inserts[0].externalId, "t2");
  });

  test("a known external id is never soft-matched (it's matched by id first)", () => {
    const plan = reconcile([fetched({ externalId: "t1", txnDate: "2026-09-17" })], [synced({ id: 1, externalId: "t1", txnDate: "2026-09-17" })], [csvRow], opts);
    assert.equal(plan.softDupes.length, 0);
    assert.equal(plan.unchanged, 1);
  });
});

describe("reconcile: pending expiry (D5)", () => {
  test("a pending row not returned and older than the cutoff expires", () => {
    const plan = reconcile([], [synced({ id: 1, externalId: "p1", status: "pending", txnDate: "2026-09-10" })], [], opts);
    assert.equal(plan.expirations.length, 1);
    assert.equal(plan.expirations[0].id, 1);
    assert.equal(plan.expirations[0].carryTo, null);
  });

  test("a pending row newer than the cutoff is left alone (provider lag)", () => {
    const plan = reconcile([], [synced({ id: 1, externalId: "p1", status: "pending", txnDate: "2026-09-16" })], [], opts);
    assert.equal(plan.expirations.length, 0);
  });

  test("cutoff is inclusive: exactly pendingExpiryDays old expires", () => {
    const plan = reconcile([], [synced({ id: 1, externalId: "p1", status: "pending", txnDate: "2026-09-13" })], [], opts);
    assert.equal(plan.expirations.length, 1);
  });

  test("a pending row that IS returned never expires, however old", () => {
    const plan = reconcile([fetched({ externalId: "p1", status: "pending", txnDate: "2026-08-01" })], [synced({ id: 1, externalId: "p1", status: "pending", txnDate: "2026-08-01" })], [], opts);
    assert.equal(plan.expirations.length, 0);
  });

  test("posted rows never expire", () => {
    const plan = reconcile([], [synced({ id: 1, externalId: "x", status: "posted", txnDate: "2026-01-01" })], [], opts);
    assert.equal(plan.expirations.length, 0);
  });

  test("edits carry to a matching NEW posted row (same money, within 5 days)", () => {
    const plan = reconcile(
      [fetched({ externalId: "new1", status: "posted", txnDate: "2026-09-12", amount: 20 })],
      [synced({ id: 1, externalId: "p1", status: "pending", txnDate: "2026-09-10", amount: 20, notes: "lunch with Sam" })],
      [],
      opts,
    );
    assert.equal(plan.inserts.length, 1);
    assert.deepEqual(plan.expirations[0].carryTo, { kind: "insert", externalId: "new1" });
    assert.equal(plan.expirations[0].edits.notes, "lunch with Sam");
  });

  test("a rule-set category is not carried (only notes/bill/hand-set category are)", () => {
    const plan = reconcile(
      [fetched({ externalId: "new1", status: "posted", txnDate: "2026-09-12", amount: 20 })],
      [synced({ id: 1, externalId: "p1", status: "pending", txnDate: "2026-09-10", amount: 20, notes: "n", category: "Dining", categoryRuleId: 9 })],
      [],
      opts,
    );
    assert.deepEqual(plan.expirations[0].carryTo, { kind: "insert", externalId: "new1" });
    assert.equal(plan.expirations[0].edits.category, null);
    assert.equal(plan.expirations[0].edits.notes, "n");
  });

  test("edits carry to a matching EXISTING posted row when no new one fits", () => {
    const plan = reconcile(
      [],
      [
        synced({ id: 1, externalId: "p1", status: "pending", txnDate: "2026-09-10", amount: 20, billId: 3 }),
        synced({ id: 2, externalId: "q1", status: "posted", txnDate: "2026-09-11", amount: 20 }),
      ],
      [],
      opts,
    );
    assert.deepEqual(plan.expirations[0].carryTo, { kind: "existing", id: 2 });
  });

  test("no carry when the pending row had no edits, even if a twin exists", () => {
    const plan = reconcile([], [synced({ id: 1, externalId: "p1", status: "pending", txnDate: "2026-09-10", amount: 20 }), synced({ id: 2, externalId: "q1", status: "posted", txnDate: "2026-09-11", amount: 20 })], [], opts);
    assert.equal(plan.expirations[0].carryTo, null);
  });

  test("a rule-set category alone does not count as an edit", () => {
    assert.equal(hasUserEdits({ category: "Dining", categoryRuleId: 4, notes: null, billId: null, billInstanceId: null }), false);
    assert.equal(hasUserEdits({ category: "Dining", categoryRuleId: null, notes: null, billId: null, billInstanceId: null }), true);
    assert.equal(hasUserEdits({ category: null, categoryRuleId: null, notes: "  ", billId: null, billInstanceId: null }), false);
  });

  test("two expirations don't carry onto the same posted row", () => {
    const plan = reconcile(
      [],
      [
        synced({ id: 1, externalId: "p1", status: "pending", txnDate: "2026-09-10", amount: 20, notes: "a" }),
        synced({ id: 2, externalId: "p2", status: "pending", txnDate: "2026-09-10", amount: 20, notes: "b" }),
        synced({ id: 3, externalId: "q1", status: "posted", txnDate: "2026-09-11", amount: 20 }),
      ],
      [],
      opts,
    );
    const targets = plan.expirations.map((e) => JSON.stringify(e.carryTo));
    assert.equal(targets.filter((t) => t === JSON.stringify({ kind: "existing", id: 3 })).length, 1);
  });

  test("an already-edited posted row is not a carry target", () => {
    const plan = reconcile(
      [],
      [
        synced({ id: 1, externalId: "p1", status: "pending", txnDate: "2026-09-10", amount: 20, notes: "a" }),
        synced({ id: 2, externalId: "q1", status: "posted", txnDate: "2026-09-11", amount: 20, notes: "already" }),
      ],
      [],
      opts,
    );
    assert.equal(plan.expirations[0].carryTo, null);
  });
});

describe("queryRange / defaultSyncFrom", () => {
  // Local-zone timestamps: queryRange reads calendar dates the way todayIso() does.
  const at = (iso: string) => new Date(`${iso}T12:00:00`);
  test("first run backfills from sync_from", () => {
    assert.deepEqual(queryRange({ today: TODAY, windowDays: 10, syncFrom: "2026-06-01", lastSyncedAt: null }), { startDate: "2026-06-01", endDate: TODAY });
  });
  test("later runs use the window, clamped to sync_from", () => {
    assert.deepEqual(queryRange({ today: TODAY, windowDays: 10, syncFrom: "2026-06-01", lastSyncedAt: at(TODAY) }), { startDate: "2026-09-10", endDate: TODAY });
    assert.deepEqual(queryRange({ today: TODAY, windowDays: 10, syncFrom: "2026-09-15", lastSyncedAt: at(TODAY) }), { startDate: "2026-09-15", endDate: TODAY });
  });
  test("a gap longer than the window is backfilled from (last sync − window)", () => {
    // Paused for three weeks: last synced Aug 30 → start Aug 20, not Sep 10.
    assert.deepEqual(queryRange({ today: TODAY, windowDays: 10, syncFrom: "2026-06-01", lastSyncedAt: at("2026-08-30") }), { startDate: "2026-08-20", endDate: TODAY });
    // …but never before sync_from.
    assert.deepEqual(queryRange({ today: TODAY, windowDays: 10, syncFrom: "2026-08-25", lastSyncedAt: at("2026-08-30") }), { startDate: "2026-08-25", endDate: TODAY });
  });
  test("the oldest pending row we hold pulls the start back so it can be judged", () => {
    assert.deepEqual(queryRange({ today: TODAY, windowDays: 10, syncFrom: "2026-06-01", lastSyncedAt: at(TODAY), oldestPending: "2026-08-28" }), { startDate: "2026-08-28", endDate: TODAY });
    assert.deepEqual(queryRange({ today: TODAY, windowDays: 10, syncFrom: "2026-06-01", lastSyncedAt: at(TODAY), oldestPending: "2026-09-15" }), { startDate: "2026-09-10", endDate: TODAY });
  });
  test("no sync_from → window only, even on first run", () => {
    assert.deepEqual(queryRange({ today: TODAY, windowDays: 7, syncFrom: null, lastSyncedAt: null }), { startDate: "2026-09-13", endDate: TODAY });
  });
  test("defaultSyncFrom = day after last local txn, else 30 days ago", () => {
    assert.equal(defaultSyncFrom("2026-08-31", TODAY), "2026-09-01");
    assert.equal(defaultSyncFrom(null, TODAY), "2026-08-21");
  });
});

describe("reconcile: hand-entered pending placeholders are settled, not skipped", () => {
  const pendingRow: ExistingOtherRow = { id: 70, txnDate: "2026-09-15", amount: 42, direction: "Debit", description: "Hotel (pending, by hand)", status: "pending" };

  test("pendingDateFits: [-1, +7] days around the pending date", () => {
    assert.equal(pendingDateFits("2026-09-15", "2026-09-14"), true);
    assert.equal(pendingDateFits("2026-09-15", "2026-09-13"), false);
    assert.equal(pendingDateFits("2026-09-15", "2026-09-22"), true);
    assert.equal(pendingDateFits("2026-09-15", "2026-09-23"), false);
  });

  test("a fetched posted row that fits settles the placeholder (finalizesPending)", () => {
    const plan = reconcile([fetched({ externalId: "t1", txnDate: "2026-09-19", amount: 42 })], [], [pendingRow], opts);
    assert.equal(plan.inserts.length, 0);
    assert.equal(plan.softDupes.length, 1);
    assert.equal(plan.softDupes[0].finalizesPending, true);
    assert.equal(plan.softDupes[0].existingId, 70);
  });

  test("outside the pending window it is a plain insert (the ±2-day rule does not apply to placeholders)", () => {
    // 8 days after → no; and a posted duplicate rule (±2) would have matched 2 days earlier, but a
    // placeholder only accepts 1 day earlier.
    assert.equal(reconcile([fetched({ externalId: "t1", txnDate: "2026-09-23", amount: 42 })], [], [pendingRow], opts).inserts.length, 1);
    assert.equal(reconcile([fetched({ externalId: "t1", txnDate: "2026-09-13", amount: 42 })], [], [pendingRow], opts).inserts.length, 1);
  });

  test("a settled (posted) other-source row is still a skip, not a settle", () => {
    const plan = reconcile([fetched({ externalId: "t1", txnDate: "2026-09-16", amount: 42 })], [], [{ ...pendingRow, status: "posted" }], opts);
    assert.equal(plan.softDupes[0].finalizesPending, false);
  });
});
