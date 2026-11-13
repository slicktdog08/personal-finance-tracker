"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  keepPendingSeparate,
  mergePendingTransaction,
  resolveStuckPending,
  setTransactionPending,
} from "@/server/actions/transactions";
import { formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import { Button, Icon, Money, Notice, type IconName } from "@/components/ds";
import type { PendingReviewItem } from "@/server/pending";
import type { Lean, Signal } from "@/server/lib/pending-diagnosis";

// The pending-transactions tray on /transactions, drawn as the kit's neutral pending Notice.
//
// Three kinds of row:
// - matched: a likely posted twin has arrived — one click merges them so the charge counts once.
// - waiting: still inside the normal settle window; the bank (or the next import) resolves it.
// - stuck: nothing will settle it on its own (its feed changed or stopped, or it's long
//   overdue). These need the user, so they get the evidence for both readings — "it posted and
//   we missed it" vs "it was only a hold" — and the action the evidence favours comes first.
export function PendingReview({ items }: { items: PendingReviewItem[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const stuck = items.filter((i) => i.diagnosis.stuck && !i.match);
  // Collapsed by default unless something needs a decision.
  const [open, setOpen] = useState(stuck.length > 0);
  const [error, setError] = useState("");

  if (!items.length) return null;
  const matched = items.filter((i) => i.match);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError("");
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        router.refresh();
      }
    });
  }

  function mergeAll() {
    setError("");
    start(async () => {
      const errors: string[] = [];
      for (const item of matched) {
        const res = await mergePendingTransaction(item.pending.id, item.match!.id, "/transactions");
        if (!res.ok) errors.push(res.error);
      }
      if (errors.length) {
        setError(errors.join(" "));
        router.refresh();
      }
    });
  }

  const merge = (pendingId: number, postedId: number) => run(() => mergePendingTransaction(pendingId, postedId, "/transactions"));
  const keepBoth = (pendingId: number, postedId: number) => run(() => keepPendingSeparate(pendingId, postedId, "/transactions"));
  const clearPending = (id: number) => run(() => setTransactionPending(id, false, "/transactions"));
  const resolve = (id: number, outcome: "posted" | "never-posted") => run(() => resolveStuckPending(id, outcome, "/transactions"));

  const signed = (dir: string, amount: number) => (dir === "Credit" ? amount : -amount);
  // The tip gap, phrased the way you'd say it: "$4.46 tip?" only for a charge that grew.
  const gapNote = (p: PendingReviewItem["pending"], amount: number) => {
    const diff = Math.round((amount - p.amount) * 100) / 100;
    if (diff === 0) return "";
    return ` (${diff > 0 ? "+" : "−"}${formatMoney(Math.abs(diff))}${diff > 0 && p.direction === "Debit" ? " tip?" : ""})`;
  };
  const first = matched[0];

  const headline = [
    `${items.length} pending`,
    matched.length > 0 && `${matched.length} look${matched.length === 1 ? "s" : ""} posted`,
    stuck.length > 0 && `${stuck.length} need${stuck.length === 1 ? "s" : ""} a decision`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Notice
      tone={stuck.length ? "warn" : "neutral"}
      icon={stuck.length ? "circle-help" : "clock-3"}
      title={headline}
      action={
        matched.length > 0 ? (
          <Button size="sm" variant="secondary" icon="merge" onClick={mergeAll} disabled={busy}>
            Merge {matched.length}
          </Button>
        ) : undefined
      }
    >
      <p>
        {stuck.length > 0 ? (
          <>
            {stuck.length === 1 ? "One charge is" : `${stuck.length} charges are`} stuck as pending — nothing will settle{" "}
            {stuck.length === 1 ? "it" : "them"} automatically. Each either posted and we missed it, or was only a hold
            that never posted.{" "}
          </>
        ) : first?.match ? (
          <>
            {first.pending.description} posted as {formatMoney(first.match.amount)}
            {gapNote(first.pending, first.match.amount)}.{" "}
          </>
        ) : (
          <>Waiting for the bank to post. </>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="font-medium text-accent-text hover:underline"
        >
          {open ? "Hide the list" : `Review ${items.length === 1 ? "it" : `all ${items.length}`}`}
        </button>
      </p>
      {error && <p className="mt-1 text-xs text-over">{error}</p>}
      {open && (
        <ul className="mt-2 divide-y divide-line rounded-panel border border-line bg-surface text-sm">
          {items.map((item) =>
            item.diagnosis.stuck && !item.match ? (
              <StuckRow
                key={item.pending.id}
                item={item}
                busy={busy}
                signed={signed}
                onMerge={(postedId) => merge(item.pending.id, postedId)}
                onResolve={(outcome) => resolve(item.pending.id, outcome)}
              />
            ) : (
              <SimpleRow
                key={item.pending.id}
                item={item}
                busy={busy}
                signed={signed}
                gapNote={gapNote}
                onMerge={() => item.match && merge(item.pending.id, item.match.id)}
                onKeepBoth={() => item.match && keepBoth(item.pending.id, item.match.id)}
                onClear={() => clearPending(item.pending.id)}
              />
            ),
          )}
        </ul>
      )}
    </Notice>
  );
}

function PendingHeader({ item, signed, extra }: { item: PendingReviewItem; signed: (d: string, a: number) => number; extra?: React.ReactNode }) {
  const p = item.pending;
  return (
    <div className="min-w-0 flex-1 basis-56">
      <div className="truncate font-medium text-fg" title={p.description}>
        {p.description}
      </div>
      <div className="text-xs text-fg-3 tabular-nums">
        {formatDate(p.txnDate)} · {p.accountLabel ?? p.accountNumber ?? "no account"} ·{" "}
        <Money value={signed(p.direction, p.amount)} kind="pending" />
        {extra}
      </div>
    </div>
  );
}

function SimpleRow({
  item,
  busy,
  signed,
  gapNote,
  onMerge,
  onKeepBoth,
  onClear,
}: {
  item: PendingReviewItem;
  busy: boolean;
  signed: (d: string, a: number) => number;
  gapNote: (p: PendingReviewItem["pending"], amount: number) => string;
  onMerge: () => void;
  onKeepBoth: () => void;
  onClear: () => void;
}) {
  const p = item.pending;
  const m = item.match;
  return (
    <li className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <PendingHeader item={item} signed={signed} />
      {m ? (
        <>
          <div className="min-w-0 flex-1 basis-56 text-xs">
            <div className="text-fg-3">Posted as</div>
            <div className="truncate text-fg" title={m.description}>
              {m.description}
            </div>
            <div className="text-fg-3 tabular-nums">
              {formatDate(m.txnDate)} · <Money value={signed(p.direction, m.amount)} />
              <span className="text-warn">{gapNote(p, m.amount)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <Button
              size="sm"
              variant="secondary"
              icon="merge"
              onClick={onMerge}
              disabled={busy}
              title="Keep the bank's row, carry over your category and notes, and remove this pending entry"
            >
              Merge
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onKeepBoth}
              disabled={busy}
              title="Not the same charge — stop suggesting this pair and keep both transactions"
            >
              Keep both
            </Button>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-fg-3">{p.synced ? "The bank settles it on a later sync" : "Waiting for it to post"}</span>
          {!p.synced && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onClear}
              disabled={busy}
              title="Stop tracking this as pending — keep it as a regular transaction"
            >
              Mark posted
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

const LEAN_TEXT: Record<Lean, string> = {
  posted: "Most likely posted",
  hold: "Most likely a hold that never posted",
  unsure: "Can't tell from the data — check your statement",
};

const SIGNAL_ICON: Record<Signal["points"], { icon: IconName; cls: string; label: string }> = {
  posted: { icon: "circle-check", cls: "text-ok", label: "Suggests it posted" },
  hold: { icon: "circle-slash-2", cls: "text-warn", label: "Suggests a hold" },
  info: { icon: "circle-help", cls: "text-fg-3", label: "Context" },
};

function StuckRow({
  item,
  busy,
  signed,
  onMerge,
  onResolve,
}: {
  item: PendingReviewItem;
  busy: boolean;
  signed: (d: string, a: number) => number;
  onMerge: (postedId: number) => void;
  onResolve: (outcome: "posted" | "never-posted") => void;
}) {
  const p = item.pending;
  const d = item.diagnosis;
  const lean = d.lean ?? "unsure";
  const hasCandidates = d.candidates.length > 0;
  const strongTwin = d.candidates[0]?.strong ?? false;

  function neverPosted() {
    if (!confirm(`Remove "${p.description}" (${formatMoney(p.amount)})? It will stop counting as spending.`)) return;
    onResolve("never-posted");
  }

  // The action the evidence favours is the filled button.
  const keepBtn = (
    <Button
      key="keep"
      size="sm"
      variant={lean === "posted" && !strongTwin ? "secondary" : "ghost"}
      icon="circle-check"
      onClick={() => onResolve("posted")}
      disabled={busy}
      title="It's on your statement, but its posted row will never arrive here — keep this as a regular, posted charge"
    >
      It posted — keep it
    </Button>
  );
  const holdBtn = (
    <Button
      key="hold"
      size="sm"
      variant={lean === "hold" ? "secondary" : "ghost"}
      icon="trash-2"
      onClick={neverPosted}
      disabled={busy}
      title="It was only an authorization hold the bank dropped — remove it so it stops counting as spending"
    >
      Never posted — remove
    </Button>
  );

  return (
    <li className="px-3 py-3 space-y-2">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <PendingHeader
          item={item}
          signed={signed}
          extra={<span className="text-warn"> · pending {d.ageDays} days</span>}
        />
        <span className="ml-auto text-xs font-medium text-fg-2">{LEAN_TEXT[lean]}</span>
      </div>

      {d.why && <p className="text-xs text-fg-2">{d.why}</p>}

      {d.signals.length > 0 && (
        <ul className="space-y-1 text-xs">
          {d.signals.map((s, i) => {
            const meta = SIGNAL_ICON[s.points];
            return (
              <li key={i} className="flex gap-1.5">
                <span className={meta.cls} title={meta.label} aria-label={meta.label}>
                  <Icon name={meta.icon} size={14} />
                </span>
                <span className="text-fg-2">{s.text}</span>
              </li>
            );
          })}
        </ul>
      )}

      {hasCandidates && (
        <div className="rounded-panel border border-line">
          <div className="px-2 pt-1.5 text-xs text-fg-3">Could have posted as</div>
          <ul className="divide-y divide-line">
            {d.candidates.map((c, i) => (
              <li key={c.id} className="px-2 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="truncate text-fg" title={c.description}>
                    {c.description}
                  </div>
                  <div className="text-fg-3 tabular-nums">
                    {formatDate(c.txnDate)} · <Money value={signed(p.direction, c.amount)} /> · {c.evidence}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={i === 0 && c.strong && lean === "posted" ? "secondary" : "ghost"}
                  icon="merge"
                  onClick={() => onMerge(c.id)}
                  disabled={busy}
                  title="Same charge — keep the posted row, carry over your category and notes, and remove the pending one"
                >
                  Same charge
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-1">{lean === "hold" ? [holdBtn, keepBtn] : [keepBtn, holdBtn]}</div>
    </li>
  );
}
