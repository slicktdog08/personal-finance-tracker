import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { ReactElement, ReactNode } from "react";
import { completeEnrollment, runSync } from "@/server/lib/sync/sync";
import { acct, closePool, FAKE, fake, setupFixtures, teardownFixtures, TODAY, txn, type Fixtures } from "./helpers";
import { enableAllFakeAccounts } from "./helpers";

// Page wiring: call the async server components directly (session stubbed via
// tests/stubs-session.cjs) and walk the element tree they return. No DOM — this checks the
// data → props plumbing that TypeScript can't (a query that throws, a missing field, a
// component rendered with the wrong shape).

let f: Fixtures;

before(async () => {
  f = await setupFixtures();
  fake.accounts = [acct({ externalId: "acc_chk", lastFour: "1111", type: "depository" })];
  fake.txns.set("acc_chk", [
    txn({ externalId: "pg1", externalAccountId: "acc_chk", txnDate: TODAY, description: "PAGE PENDING", amount: 7, status: "pending" }),
    txn({ externalId: "pg2", externalAccountId: "acc_chk", txnDate: TODAY, description: "PAGE POSTED", amount: 8 }),
  ]);
  fake.balances.set("acc_chk", { ledger: 100, available: 90 });
  await completeEnrollment({ provider: FAKE, accessToken: "tok", enrollmentId: "enr_e2e", institutionName: "Fake Bank" });
  await enableAllFakeAccounts();
  const s = await runSync({ trigger: "cli" });
  assert.equal(s.status, "ok");
});
after(async () => {
  await teardownFixtures(f);
  await closePool();
});

type El = ReactElement<Record<string, unknown>>;
function isEl(n: unknown): n is El {
  return typeof n === "object" && n != null && "props" in n && "type" in n;
}
// Element-valued props other than children (a Panel's `action`, a card's `badge`) are
// part of the tree too, so walks visit every prop that holds elements.
function childNodes(el: El): ReactNode[] {
  return Object.values(el.props).filter((v) => isEl(v) || Array.isArray(v) || typeof v === "string") as ReactNode[];
}
// Depth-first search over a React element tree.
function find(node: ReactNode, pred: (el: El) => boolean): El | null {
  if (Array.isArray(node)) {
    for (const c of node) {
      const r = find(c, pred);
      if (r) return r;
    }
    return null;
  }
  if (!isEl(node)) return null;
  if (pred(node)) return node;
  return find(childNodes(node), pred);
}
const named = (name: string) => (el: El) => typeof el.type === "function" && (el.type as { name?: string }).name === name;
const textOf = (node: ReactNode): string => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isEl(node)) return childNodes(node).map(textOf).join("");
  return "";
};

describe("/settings/sync", () => {
  test("renders status, enrollments with mapping, run history, advanced", async () => {
    const { default: Page } = await import("@/app/settings/sync/page");
    const tree = await Page({ searchParams: Promise.resolve({}) });
    const status = find(tree, named("SyncStatusCard"));
    assert.ok(status, "SyncStatusCard rendered");
    const st = status.props.settings as { enabled: boolean; intervalMinutes: number; running: boolean };
    assert.equal(typeof st.enabled, "boolean");
    assert.equal(st.running, false);
    const pending = status.props.pending as { count: number; debits: number };
    assert.equal(pending.count, 1);
    assert.equal(pending.debits, 7);
    assert.equal(status.props.activeEnrollments, 1);
    const last = status.props.lastRun as { status: string; inserted: number };
    assert.equal(last.status, "ok");
    assert.equal(last.inserted, 2);

    const list = find(tree, named("EnrollmentList"));
    assert.ok(list);
    const enrollments = list.props.enrollments as { institutionName: string; accounts: { accountId: number | null; lastFour: string }[] }[];
    assert.equal(enrollments.length, 1);
    assert.equal(enrollments[0].institutionName, "Fake Bank");
    assert.equal(enrollments[0].accounts[0].accountId, f.checkingId);
    const locals = list.props.localAccounts as { id: number; label: string }[];
    assert.ok(locals.some((l) => l.id === f.checkingId && l.label === "[e2e] Checking"));
    const connect = list.props.connect as { ready: boolean; problems: string[] };
    assert.equal(typeof connect.ready, "boolean");

    const history = find(tree, named("SyncRunHistory"));
    assert.ok(history);
    const runs = history.props.runs as { status: string; details: unknown }[];
    assert.ok(runs.length >= 1);
    assert.equal(runs[0].status, "ok");
    assert.ok(find(tree, named("AdvancedSyncSettings")));
  });
});

describe("/transactions with status filter", () => {
  test("pending=1 narrows the page to pending rows and the table gets pending/source", async () => {
    const { default: Page } = await import("@/app/transactions/page");
    const tree = await Page({ searchParams: Promise.resolve({ pending: "1", account: String(f.checkingId) }) });
    const table = find(tree, named("TransactionsTable"));
    assert.ok(table, "TransactionsTable rendered");
    const rows = table.props.rows as { description: string; pending: boolean; source: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].description, "PAGE PENDING");
    assert.equal(rows[0].pending, true);
    assert.equal(rows[0].source, FAKE);
    const filters = find(tree, named("TransactionFilters"));
    assert.equal((filters!.props.initial as { pending: boolean }).pending, true);

    const all = await Page({ searchParams: Promise.resolve({ account: String(f.checkingId) }) });
    const t2 = find(all, named("TransactionsTable"))!;
    assert.equal((t2.props.rows as unknown[]).length, 2);
  });
});

describe("/accounts and dashboard", () => {
  test("account card shows sync info for the synced account", async () => {
    const { default: Page } = await import("@/app/accounts/page");
    const tree = await Page();
    const card = find(tree, (el) => named("AccountCard")(el) && (el.props.account as { id: number }).id === f.checkingId);
    assert.ok(card, "AccountCard for the fixture account");
    const sync = card.props.sync as { provider: string; enabled: boolean; lastSyncedAt: string | null } | null;
    assert.ok(sync);
    assert.equal(sync.provider, FAKE);
    assert.equal(sync.enabled, true);
    assert.ok(sync.lastSyncedAt);
  });

  test("dashboard renders the pending chip for the current month", async () => {
    const { default: Page } = await import("@/app/dashboard/page");
    const tree = await Page({ searchParams: Promise.resolve({ period: TODAY.slice(0, 7) }) });
    const text = textOf(tree);
    assert.match(text, /1 pending/);
  });
});

describe("SyncNotice", () => {
  test("silent when healthy, shows when an enrollment is disconnected", async () => {
    const { SyncNotice } = await import("@/components/SyncNotice");
    assert.equal(await SyncNotice(), null);
    const { markEnrollmentDisconnected } = await import("@/server/lib/sync/sync");
    await markEnrollmentDisconnected(FAKE, "enr_e2e", "disconnected.credentials_invalid");
    const el = await SyncNotice();
    assert.ok(el);
    assert.match(textOf(el), /Fake Bank needs reconnecting/);
  });
});
