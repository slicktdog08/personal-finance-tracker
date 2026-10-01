import type { ProviderTransaction, TxnDirection, TxnStatus } from "./provider";

// Pure reconciliation of one account's fetched window against what the DB already holds.
// sync.ts turns the plan this returns into writes. Rules (planning/features/bank-sync.md):
//   D3  synced rows are matched by external id, never by content hash
//   D4  a fetched row with no external match is checked against NON-synced rows (CSV/PDF/
//       manual) in the window — same amount + direction, date within ±softMatchDays — and
//       skipped as a soft duplicate; each existing row absorbs at most one fetched row
//   D5  a pending row the provider stopped returning expires after pendingExpiryDays; user
//       edits on it are carried to a posted row that looks like the same charge, if any
//   D9  when a row's description changes on posting, rules re-run only if the category was
//       rule-set or empty — a hand-set category is never touched

// The provider-owned fields, as last delivered by the provider. Stored alongside each
// synced row (transactions.raw.seen) so a later run can tell "the bank changed this"
// from "the user edited this" — only the former is written back (D12).
export interface SeenSnapshot {
  txnDate: string;
  description: string;
  amount: number;
  direction: TxnDirection;
  status: TxnStatus;
}

export function snapshotOf(t: Pick<ProviderTransaction, "txnDate" | "description" | "amount" | "direction" | "status">): SeenSnapshot {
  return { txnDate: t.txnDate, description: t.description, amount: t.amount, direction: t.direction, status: t.status };
}

export interface ExistingSyncedRow {
  id: number;
  externalId: string;
  txnDate: string;
  description: string;
  amount: number;
  direction: TxnDirection;
  status: TxnStatus;
  category: string | null;
  categoryRuleId: number | null;
  notes: string | null;
  billId: number | null;
  billInstanceId: number | null;
  // What the provider last sent for this row; null for rows written before this existed
  // (then the stored values are compared instead, so a hand edit could be overwritten once).
  lastSeen: SeenSnapshot | null;
}

export interface ExistingOtherRow {
  id: number;
  txnDate: string;
  amount: number;
  direction: TxnDirection;
  description: string;
  // A PENDING row entered by hand is not a duplicate to skip but a placeholder to settle:
  // the fetched row takes it over (sync.ts converts it into the synced row).
  status?: TxnStatus;
}

export interface ReconcileOptions {
  today: string; // ISO
  pendingExpiryDays: number;
  softMatchDays?: number; // default 2
  carryMatchDays?: number; // default 5
}

export interface RowUpdate {
  id: number;
  // Empty when only the stored snapshot needs refreshing (provider moved to what the user
  // had already set by hand).
  changes: Partial<SeenSnapshot>;
  promoted: boolean; // pending → posted
  redoCategory: boolean; // D9
  existingBillId: number | null; // so promotion can attach a rule's bill if none is set
  fetched: ProviderTransaction;
}

export type CarryTarget = { kind: "existing"; id: number } | { kind: "insert"; externalId: string };

export interface Expiration {
  id: number;
  externalId: string;
  carryTo: CarryTarget | null;
  edits: { category: string | null; notes: string | null; billId: number | null; billInstanceId: number | null };
}

export interface SoftDuplicate {
  fetched: ProviderTransaction;
  existingId: number;
  existingDescription: string;
  // True when the existing row is a hand-entered pending placeholder that this fetched row
  // settles (update it in place) rather than a settled duplicate (skip the fetched row).
  finalizesPending: boolean;
}

// A hand-entered pending row is settled by a posted row dated within [−1, +7] days of it:
// banks post a day or more after the authorization, almost never before.
export const PENDING_MATCH_BEFORE_DAYS = 1;
export const PENDING_MATCH_AFTER_DAYS = 7;
export function pendingDateFits(pendingDate: string, postedDate: string): boolean {
  const diff = Math.round((Date.parse(`${postedDate}T00:00:00Z`) - Date.parse(`${pendingDate}T00:00:00Z`)) / 86_400_000);
  return diff >= -PENDING_MATCH_BEFORE_DAYS && diff <= PENDING_MATCH_AFTER_DAYS;
}

export interface ReconcilePlan {
  inserts: ProviderTransaction[];
  updates: RowUpdate[];
  expirations: Expiration[];
  softDupes: SoftDuplicate[];
  unchanged: number;
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.abs(Math.round(ms / 86_400_000));
}

// Calendar date in the server's local zone — the same convention as todayIso(), so a
// timestamp taken late in the evening doesn't roll into "tomorrow" via UTC.
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function sameMoney(a: { amount: number; direction: string }, b: { amount: number; direction: string }): boolean {
  return a.direction === b.direction && Math.abs(a.amount - b.amount) < 0.005;
}

// A pending row is "edited" when the user touched it: a note, a bill link, or a category they
// set by hand (rule-set categories are re-derivable and not worth carrying).
export function hasUserEdits(row: Pick<ExistingSyncedRow, "category" | "categoryRuleId" | "notes" | "billId" | "billInstanceId">): boolean {
  return Boolean(
    (row.notes && row.notes.trim()) ||
      row.billId != null ||
      row.billInstanceId != null ||
      (row.category != null && row.categoryRuleId == null),
  );
}

export function reconcile(
  fetchedRaw: ProviderTransaction[],
  existingSynced: ExistingSyncedRow[],
  existingOther: ExistingOtherRow[],
  opts: ReconcileOptions,
): ReconcilePlan {
  const softMatchDays = opts.softMatchDays ?? 2;
  const carryMatchDays = opts.carryMatchDays ?? 5;

  // Pages can overlap at the boundary; last one wins (it's the same row).
  const fetchedById = new Map<string, ProviderTransaction>();
  for (const t of fetchedRaw) fetchedById.set(t.externalId, t);
  const fetched = [...fetchedById.values()];

  const syncedById = new Map(existingSynced.map((r) => [r.externalId, r]));
  const plan: ReconcilePlan = { inserts: [], updates: [], expirations: [], softDupes: [], unchanged: 0 };

  // 1. Known external ids → detect changes / promotion.
  // 2. Unknown → soft-match against other sources, else insert.
  const consumedOther = new Set<number>();
  for (const t of fetched) {
    const existing = syncedById.get(t.externalId);
    if (existing) {
      // A field is written only when the PROVIDER changed it (vs. what it last sent) and the
      // stored value differs. Compared against the stored row when no snapshot exists.
      const base = existing.lastSeen ?? existing;
      const changes: RowUpdate["changes"] = {};
      if (base.txnDate !== t.txnDate && existing.txnDate !== t.txnDate) changes.txnDate = t.txnDate;
      if (base.description !== t.description && existing.description !== t.description) changes.description = t.description;
      if (Math.abs(base.amount - t.amount) >= 0.005 && Math.abs(existing.amount - t.amount) >= 0.005) changes.amount = t.amount;
      if (base.direction !== t.direction && existing.direction !== t.direction) changes.direction = t.direction;
      if (base.status !== t.status && existing.status !== t.status) changes.status = t.status;
      // The snapshot itself must be refreshed whenever the provider's view moved, even if
      // The user's edit already matches it — otherwise the next run would diff against stale data.
      const seenMoved =
        existing.lastSeen == null ||
        base.txnDate !== t.txnDate ||
        base.description !== t.description ||
        Math.abs(base.amount - t.amount) >= 0.005 ||
        base.direction !== t.direction ||
        base.status !== t.status;
      if (Object.keys(changes).length === 0 && !seenMoved) {
        plan.unchanged++;
        continue;
      }
      plan.updates.push({
        id: existing.id,
        changes,
        promoted: existing.status === "pending" && t.status === "posted",
        redoCategory:
          changes.description != null && (existing.categoryRuleId != null || existing.category == null),
        existingBillId: existing.billId,
        fetched: t,
      });
      continue;
    }

    const dupe = existingOther.find(
      (o) =>
        !consumedOther.has(o.id) &&
        sameMoney(o, t) &&
        (o.status === "pending" ? pendingDateFits(o.txnDate, t.txnDate) : daysBetween(o.txnDate, t.txnDate) <= softMatchDays),
    );
    if (dupe) {
      consumedOther.add(dupe.id);
      plan.softDupes.push({ fetched: t, existingId: dupe.id, existingDescription: dupe.description, finalizesPending: dupe.status === "pending" });
      continue;
    }
    plan.inserts.push(t);
  }

  // 3. Pending rows the provider no longer returns.
  const expiryCutoff = addDays(opts.today, -opts.pendingExpiryDays);
  const postedCandidatesExisting = existingSynced.filter((r) => r.status === "posted" && !hasUserEdits(r));
  const claimed = new Set<string>(); // carry targets, so two expirations don't land on one row
  for (const row of existingSynced) {
    if (row.status !== "pending" || fetchedById.has(row.externalId)) continue;
    if (row.txnDate > expiryCutoff) continue; // too recent — provider may just be lagging
    let carryTo: CarryTarget | null = null;
    if (hasUserEdits(row)) {
      const ins = plan.inserts.find(
        (t) =>
          t.status === "posted" &&
          !claimed.has(`i:${t.externalId}`) &&
          sameMoney(t, row) &&
          daysBetween(t.txnDate, row.txnDate) <= carryMatchDays,
      );
      if (ins) {
        carryTo = { kind: "insert", externalId: ins.externalId };
        claimed.add(`i:${ins.externalId}`);
      } else {
        const ex = postedCandidatesExisting.find(
          (r) =>
            !claimed.has(`e:${r.id}`) && sameMoney(r, row) && daysBetween(r.txnDate, row.txnDate) <= carryMatchDays,
        );
        if (ex) {
          carryTo = { kind: "existing", id: ex.id };
          claimed.add(`e:${ex.id}`);
        }
      }
    }
    plan.expirations.push({
      id: row.id,
      externalId: row.externalId,
      carryTo,
      // A rule-set category is not carried: the twin runs the rules itself, and stamping it
      // as hand-set would hide the provenance.
      edits: {
        category: row.categoryRuleId == null ? row.category : null,
        notes: row.notes,
        billId: row.billId,
        billInstanceId: row.billInstanceId,
      },
    });
  }

  return plan;
}

// Query window for a run: never before the account's sync-from date; otherwise far enough
// back to (a) catch pending → posted date shifts (`windowDays`, 7–10 is typical), (b) cover any
// gap since the last successful sync — a paused/disconnected/down account resumes without
// a hole — and (c) include every pending row we hold, so "not returned" really means the
// bank dropped it (`oldestPending`).
export function queryRange(opts: {
  today: string;
  windowDays: number;
  syncFrom: string | null;
  lastSyncedAt: Date | null;
  oldestPending?: string | null;
}): { startDate: string; endDate: string } {
  const windowStart = addDays(opts.today, -opts.windowDays);
  let start: string;
  if (opts.lastSyncedAt == null) {
    // Never synced: backfill from sync_from (or just the window when there is none).
    start = opts.syncFrom ?? windowStart;
  } else {
    const lastIso = localIso(opts.lastSyncedAt);
    const gapStart = addDays(lastIso, -opts.windowDays);
    start = gapStart < windowStart ? gapStart : windowStart;
    if (opts.syncFrom && opts.syncFrom > start) start = opts.syncFrom;
  }
  if (opts.oldestPending && opts.oldestPending < start) start = opts.oldestPending;
  if (start > opts.today) start = opts.today;
  return { startDate: start, endDate: opts.today };
}

// Default sync-from when mapping an external account to a local one (D4): the day after the
// last transaction we already hold for that local account, else 30 days ago.
export function defaultSyncFrom(lastLocalTxnDate: string | null, today: string): string {
  return lastLocalTxnDate ? addDays(lastLocalTxnDate, 1) : addDays(today, -30);
}

export { addDays as addDaysIso };
