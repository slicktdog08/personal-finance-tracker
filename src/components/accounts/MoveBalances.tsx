"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { moveAccountBalances } from "@/server/actions/accounts";
import { BALANCE_SOURCES, LIABILITY_ACCOUNT_TYPES } from "@/constants/enums";
import { formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import { Badge, Button, Checkbox, Field, Input, Money, Notice, Segmented, Select, Sheet, cx } from "@/components/ds";

export interface MoveAccountChoice {
  id: number;
  name: string;
  accountNumber: string;
  accountType: string | null;
}

export interface MoveBalanceRow {
  id: number;
  accountId: number;
  asOf: string;
  balance: string;
  creditLimit: string | null;
  apr: string | null;
  minPayment: string | null;
  note: string | null;
  source: string | null;
}

type Conflict = "skip" | "replace";
type Done = { moved: number[]; skipped: number; replaced: number; fromId: number; intoId: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const last4 = (a: MoveAccountChoice) => `··${a.accountNumber.slice(-4)}`;
const SOURCE_LABEL: Record<string, string> = {
  [BALANCE_SOURCES.statement]: "Statement",
  [BALANCE_SOURCES.statementDaily]: "Daily",
};

/**
 * Move hand-picked balance snapshots — balance, credit limit, APR, minimum payment — from one
 * account to another. The selective cousin of Merge: for history recorded against the wrong
 * account, or split off a card before it was reissued. Both accounts stay.
 */
export function MoveBalances({ accounts, balances }: { accounts: MoveAccountChoice[]; balances: MoveBalanceRow[] }) {
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState("");
  const [intoId, setIntoId] = useState("");
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const [showDaily, setShowDaily] = useState(false);
  const [conflict, setConflict] = useState<Conflict>("skip");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [moving, startMove] = useTransition();
  const [undoing, startUndo] = useTransition();
  // Shift-click selects a run of rows, like a file list.
  const anchor = useRef<number | null>(null);

  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of balances) m.set(b.accountId, (m.get(b.accountId) ?? 0) + 1);
    return m;
  }, [balances]);

  const from = accounts.find((a) => String(a.id) === fromId) ?? null;
  const into = accounts.find((a) => String(a.id) === intoId) ?? null;

  // Newest first, the way every balance history in the app reads.
  const source = useMemo(
    () => balances.filter((b) => String(b.accountId) === fromId).sort((a, b) => (a.asOf < b.asOf ? 1 : a.asOf > b.asOf ? -1 : b.id - a.id)),
    [balances, fromId],
  );
  const intoDates = useMemo(() => new Set(balances.filter((b) => String(b.accountId) === intoId).map((b) => b.asOf)), [balances, intoId]);
  const dailyCount = source.filter((b) => b.source === BALANCE_SOURCES.statementDaily).length;

  const shown = source.filter(
    (b) =>
      (showDaily || b.source !== BALANCE_SOURCES.statementDaily || selected.has(b.id)) &&
      (!after || b.asOf >= after) &&
      (!before || b.asOf <= before),
  );
  const picked = source.filter((b) => selected.has(b.id));
  const clashes = picked.filter((b) => intoDates.has(b.asOf)).length;
  const willMove = conflict === "skip" ? picked.length - clashes : picked.length;
  const allShown = shown.length > 0 && shown.every((b) => selected.has(b.id));
  const someShown = shown.some((b) => selected.has(b.id));

  const isLiab = (a: MoveAccountChoice | null) => LIABILITY_ACCOUNT_TYPES.includes(a?.accountType ?? "");
  const kindMismatch = from && into && from.accountType && into.accountType && isLiab(from) !== isLiab(into);

  const reset = () => {
    setFromId("");
    setIntoId("");
    setSelected(new Set());
    setAfter("");
    setBefore("");
    setShowDaily(false);
    setConflict("skip");
    setError(null);
    setDone(null);
    anchor.current = null;
  };
  const close = () => {
    setOpen(false);
    reset();
  };

  const chooseFrom = (v: string) => {
    setFromId(v);
    if (v === intoId) setIntoId("");
    setSelected(new Set());
    setError(null);
    setDone(null);
    anchor.current = null;
  };

  const toggle = (id: number, index: number, shift: boolean) => {
    // Read the anchor now: the updater runs later, after it has moved to this row.
    const from = shift ? anchor.current : null;
    const range = from == null ? null : shown.slice(Math.min(from, index), Math.max(from, index) + 1);
    setSelected((prev) => {
      const next = new Set(prev);
      const on = !prev.has(id);
      if (range) {
        for (const b of range) {
          if (on) next.add(b.id);
          else next.delete(b.id);
        }
      } else if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    anchor.current = index;
  };

  const toggleAllShown = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const b of shown) {
        if (allShown) next.delete(b.id);
        else next.add(b.id);
      }
      return next;
    });

  const move = () =>
    startMove(async () => {
      setError(null);
      const res = await moveAccountBalances([...selected], Number(fromId), Number(intoId), conflict);
      if (!res.ok) return setError(res.error);
      setDone({ moved: res.moved, skipped: res.skipped, replaced: res.replaced, fromId: Number(fromId), intoId: Number(intoId) });
      setSelected(new Set());
      anchor.current = null;
    });

  // Moving them straight back is a true undo unless the destination's own rows were replaced.
  const undo = () =>
    startUndo(async () => {
      if (!done) return;
      const res = await moveAccountBalances(done.moved, done.intoId, done.fromId, "skip");
      if (!res.ok) return setError(res.error);
      setDone(null);
    });

  const option = (a: MoveAccountChoice) => ({
    value: String(a.id),
    label: `${a.name} ${last4(a)}${a.accountType ? ` (${a.accountType})` : ""} · ${plural(counts.get(a.id) ?? 0, "balance")}`,
  });

  if (accounts.length < 2) return null;

  const ready = !!from && !!into && willMove > 0 && !moving;

  return (
    <>
      <Button variant="ghost" icon="arrow-left-right" onClick={() => setOpen(true)}>
        Move balances
      </Button>
      <Sheet
        open={open}
        onClose={close}
        title="Move balance history"
        desktop="centered"
        wide
        footer={
          // Pinned to the dialog's bottom edge (the negative offsets cancel the Sheet's padding) so the
          // Move button stays in reach while the list scrolls.
          <div className="sticky -bottom-4 z-10 -mx-4 mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-raised px-4 py-3 md:-bottom-5 md:-mx-5 md:px-5">
            <span className="mr-auto text-sm text-fg-3" aria-live="polite">
              {picked.length
                ? `${plural(picked.length, "balance")} selected${clashes ? ` · ${clashes} on dates ${into?.name ?? "it"} already has` : ""}`
                : from
                  ? "Nothing selected"
                  : ""}
            </span>
            <Button variant="ghost" onClick={close}>
              {done ? "Done" : "Cancel"}
            </Button>
            <Button icon="arrow-right" onClick={move} loading={moving} disabled={!ready}>
              {willMove ? `Move ${plural(willMove, "balance")}` : "Move"}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3">
          <p className="text-sm text-fg-2">
            Pick balance snapshots on one account — balance, limit, APR and minimum payment — and move them to another.
            Transactions don&apos;t move, and both accounts stay. To fold one account into another entirely, use Merge.
          </p>

          <div className="grid items-end gap-3 md:grid-cols-[1fr_auto_1fr]">
            <Field label="From" htmlFor="move-from">
              <Select
                id="move-from"
                value={fromId}
                onChange={(e) => chooseFrom(e.target.value)}
                options={[{ value: "", label: "Choose…" }, ...accounts.filter((a) => counts.get(a.id)).map(option)]}
              />
            </Field>
            <span className="hidden pb-2.5 text-fg-3 md:block" aria-hidden>
              →
            </span>
            <Field label="To" htmlFor="move-into">
              <Select
                id="move-into"
                value={intoId}
                disabled={!fromId}
                onChange={(e) => {
                  setIntoId(e.target.value);
                  setError(null);
                }}
                options={[{ value: "", label: "Choose…" }, ...accounts.filter((a) => String(a.id) !== fromId).map(option)]}
              />
            </Field>
          </div>

          {done && (
            <Notice tone="ok">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  Moved {plural(done.moved.length, "balance")} to {accounts.find((a) => a.id === done.intoId)?.name}.
                  {done.skipped ? ` ${plural(done.skipped, "was", "were")} left behind: those dates were already there.` : ""}
                  {done.replaced ? ` ${plural(done.replaced, "existing snapshot")} replaced.` : ""}
                </span>
                {done.replaced === 0 && done.moved.length > 0 && (
                  <Button size="sm" variant="secondary" icon="rotate-ccw" onClick={undo} loading={undoing}>
                    Undo
                  </Button>
                )}
              </div>
            </Notice>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
          {kindMismatch && (
            <Notice tone="warn">
              {from!.name} is a {from!.accountType} account and {into!.name} is {into!.accountType}. A liability&apos;s
              balance is what&apos;s owed, so these numbers will read the opposite way on the other account.
            </Notice>
          )}

          {from && (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="On or after" htmlFor="move-after" className="min-w-[9.5rem] flex-1">
                  <Input id="move-after" type="date" value={after} max={before || undefined} onChange={(e) => setAfter(e.target.value)} />
                </Field>
                <Field label="On or before" htmlFor="move-before" className="min-w-[9.5rem] flex-1">
                  <Input id="move-before" type="date" value={before} min={after || undefined} onChange={(e) => setBefore(e.target.value)} />
                </Field>
                {(after || before) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mb-1"
                    onClick={() => {
                      setAfter("");
                      setBefore("");
                    }}
                  >
                    Clear dates
                  </Button>
                )}
              </div>

              {clashes > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-panel bg-sunken p-3 text-sm">
                  <span className="text-fg-2">
                    {plural(clashes, "selected balance")} {clashes === 1 ? "falls" : "fall"} on a date {into!.name} already has.
                  </span>
                  <Segmented<Conflict>
                    label="Dates both accounts have"
                    value={conflict}
                    onChange={setConflict}
                    options={[
                      { value: "skip", label: "Keep theirs" },
                      { value: "replace", label: "Replace theirs" },
                    ]}
                  />
                  {conflict === "replace" && (
                    <p className="w-full text-xs text-fg-3">
                      Replacing deletes {into!.name}&apos;s own snapshots on those dates, so it can&apos;t be undone.
                    </p>
                  )}
                </div>
              )}
              <div className="overflow-hidden rounded-panel border border-line">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sunken px-3 py-2">
                  {/* Raw markup rather than <Checkbox>: the header box needs a ref for its indeterminate state. */}
                  <label className="mp-check">
                    <input
                      type="checkbox"
                      checked={allShown}
                      ref={(el) => {
                        if (el) el.indeterminate = someShown && !allShown;
                      }}
                      onChange={toggleAllShown}
                      disabled={!shown.length}
                    />
                    <span className="text-sm">
                      {allShown ? "Deselect" : "Select"} {shown.length === source.length ? "all" : "shown"} ({shown.length})
                    </span>
                  </label>
                  <div className="flex items-center gap-3">
                    {dailyCount > 0 && (
                      <Checkbox
                        label={<span className="text-sm text-fg-2">Daily statement balances ({dailyCount})</span>}
                        checked={showDaily}
                        onChange={(e) => setShowDaily(e.target.checked)}
                      />
                    )}
                    {selected.size > 0 && (
                      <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                        Clear
                      </Button>
                    )}
                  </div>
                </div>

                <ul className="md:max-h-[40vh] md:overflow-y-auto md:overscroll-contain" role="list">
                  {shown.length === 0 && (
                    <li className="px-3 py-6 text-center text-sm text-fg-3">
                      {source.length ? "No balances match these dates." : "This account has no balance history."}
                    </li>
                  )}
                  {shown.map((b, i) => {
                    const on = selected.has(b.id);
                    const clash = !!into && intoDates.has(b.asOf);
                    const facts = [
                      b.creditLimit != null ? `limit ${formatMoney(b.creditLimit)}` : null,
                      b.apr != null ? `${Number(b.apr)}% APR` : null,
                      b.minPayment != null ? `min ${formatMoney(b.minPayment)}` : null,
                    ].filter(Boolean);
                    return (
                      <li key={b.id} className="border-b border-line last:border-b-0">
                        <label
                          className={cx(
                            "flex cursor-pointer select-none items-start gap-3 px-3 py-2.5 hover:bg-hover",
                            on && "bg-[color-mix(in_oklch,var(--mp-accent)_9%,transparent)]",
                          )}
                          onClick={(e) => {
                            // The label forwards the click to the checkbox; handle it once, here.
                            e.preventDefault();
                            toggle(b.id, i, e.shiftKey);
                          }}
                        >
                          <span className="mp-check pt-0.5">
                            <input type="checkbox" checked={on} readOnly tabIndex={-1} aria-label={`${formatDate(b.asOf)} ${formatMoney(b.balance)}`} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-3">
                              <span className="text-sm font-medium">{formatDate(b.asOf)}</span>
                              <Money value={b.balance} kind="neutral" className="text-sm tabular-nums" />
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
                              {facts.length > 0 && <span>{facts.join(" · ")}</span>}
                              {b.note && <span className="truncate">“{b.note}”</span>}
                              {b.source && SOURCE_LABEL[b.source] && <Badge label={SOURCE_LABEL[b.source]} size="sm" dot={false} />}
                              {clash && (
                                <Badge
                                  label={`${into!.name} has this date`}
                                  size="sm"
                                  variant="outline"
                                  icon="triangle-alert"
                                  title={conflict === "skip" ? "Will be left here" : `Replaces ${into!.name}'s snapshot`}
                                />
                              )}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {shown.length > 1 && <p className="-mt-1 hidden text-xs text-fg-3 md:block">Tip: shift-click to select a run of dates.</p>}

            </>
          )}
        </div>
      </Sheet>
    </>
  );
}
