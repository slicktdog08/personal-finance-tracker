"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import type { LinkedPair, TransfersData, TxnLite } from "@/server/lib/transfers";
import {
  linkTransfer,
  unlinkTransfer,
  unmarkTransfer,
  dismissSuggestion,
} from "@/server/actions/transfers";
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  Glyph,
  IconButton,
  Money,
  Notice,
  Select,
} from "@/components/ds";

// Which side money left from and which it landed on. A linked pair is stored as a/b with no
// order, so read it off the directions (falling back to the stored order for odd data).
function fromTo(p: { a: TxnLite; b: TxnLite }): { from: TxnLite; to: TxnLite } {
  if (p.a.direction === "Credit" && p.b.direction !== "Credit") return { from: p.b, to: p.a };
  return { from: p.a, to: p.b };
}

export function TransfersManager({
  data,
  periods,
  selected,
}: {
  data: TransfersData;
  periods: { label: string; pretty: string }[];
  selected: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Record<number, number>>(
    Object.fromEntries(
      data.unmatched.filter((u) => u.candidates.length).map((u) => [u.txn.id, u.candidates[0].id]),
    ),
  );

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      await fn();
    });

  const linkedRows = data.linked.map((p, i) => ({ id: i, pair: p, ...fromTo(p) }));

  return (
    <div className="space-y-4">
      {/* Month filter */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Month"
          value={selected}
          onChange={(e) =>
            router.push(e.target.value ? `/transfers?period=${e.target.value}` : "/transfers")
          }
          options={[{ value: "", label: "All months" }, ...periods.map((p) => ({ value: p.label, label: p.pretty }))]}
          className="!w-auto min-w-44"
        />
        {selected && <span className="text-xs text-fg-3">Transfers touching {selected}</span>}
      </div>

      {/* Suggested matches */}
      <Card title="Suggested transfers" meta={String(data.suggestions.length)}>
        <p className="mb-2 text-xs text-fg-3">
          Same amount, opposite direction, different accounts, within a few days. Hover a row to
          read the full descriptions.
        </p>
        {data.suggestions.length === 0 ? (
          <EmptyState compact icon="repeat" title="No transfer-like pairs to confirm" />
        ) : (
          <ul className="divide-y divide-line">
            {data.suggestions.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                <Pair from={s.debit} to={s.credit} note={s.daysApart === 0 ? "same day" : `${s.daysApart} days apart`} />
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => run(() => dismissSuggestion(s.debit.id, s.credit.id))}
                    disabled={pending}
                    title="Hide this suggestion permanently"
                  >
                    Dismiss
                  </Button>
                  <Button
                    size="sm"
                    icon="check"
                    onClick={() => run(() => linkTransfer(s.debit.id, s.credit.id))}
                    disabled={pending}
                  >
                    Confirm transfer
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Flagged but unmatched */}
      <Card title="Flagged transfers needing a match" meta={String(data.unmatched.length)}>
        <p className="mb-2 text-xs text-fg-3">
          Transactions you categorized as Transfer that aren&apos;t linked to their other side yet.
        </p>
        {data.unmatched.length === 0 ? (
          <EmptyState compact icon="link" title="Nothing flagged and unmatched" />
        ) : (
          <ul className="divide-y divide-line">
            {data.unmatched.map((u) => {
              const selId = sel[u.txn.id] ?? u.candidates[0]?.id;
              const selCand = u.candidates.find((c) => c.id === selId);
              return (
                <li key={u.txn.id} className="space-y-2 py-2.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <Single t={u.txn} />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => run(() => unmarkTransfer(u.txn.id))}
                      disabled={pending}
                      className="ml-auto shrink-0"
                    >
                      Not a transfer
                    </Button>
                  </div>
                  {u.candidates.length === 0 ? (
                    <Notice tone="warn">
                      No matching counterpart in your imported data — the other side may not be
                      imported yet. It still won&apos;t count as income or spending.
                    </Notice>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        aria-label="Link to"
                        value={String(selId ?? "")}
                        onChange={(e) => setSel((m) => ({ ...m, [u.txn.id]: Number(e.target.value) }))}
                        disabled={pending}
                        title={
                          selCand
                            ? `${selCand.account} · ${formatDate(selCand.date)} · ${formatMoney(
                                selCand.amount,
                              )} · ${selCand.description}`
                            : undefined
                        }
                        options={u.candidates.map((c) => ({
                          value: String(c.id),
                          label: `${c.account} · ${formatDate(c.date)} · ${formatMoney(c.amount)} · ${c.description}`,
                        }))}
                        className="!h-9 min-w-0 flex-1 sm:min-w-[22rem]"
                      />
                      <Button
                        size="sm"
                        icon="link"
                        onClick={() => run(() => linkTransfer(u.txn.id, selId))}
                        disabled={pending || !selId}
                        className="shrink-0"
                      >
                        Link
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Linked — the kit's transfers table */}
      <Card title="Linked transfers" meta={String(data.linked.length)} padded={false}>
        <div className="px-5 pb-1 pt-3 max-md:px-3.5">
          <Notice tone="info">
            Moves between your own accounts. They&apos;re kept out of spending and income.
          </Notice>
        </div>
        {linkedRows.length === 0 ? (
          <EmptyState compact icon="repeat" title="No linked transfers yet" />
        ) : (
          <DataTable
            rows={linkedRows}
            columns={[
              { key: "date", header: "Date", shrink: true, render: (r) => <span className="tabular-nums text-fg-2">{formatDate(r.from.date)}</span> },
              { key: "from", header: "From", render: (r) => <Side t={r.from} /> },
              { key: "arrow", header: "", shrink: true, render: () => <span className="text-fg-3">→</span> },
              { key: "to", header: "To", render: (r) => <Side t={r.to} /> },
              { key: "amt", header: "Amount", num: true, render: (r) => <Money value={r.from.amount} kind="neutral" /> },
              { key: "act", header: "", shrink: true, render: (r) => <UnlinkButton pair={r.pair} disabled={pending} onUnlink={(id) => run(() => unlinkTransfer(id))} /> },
            ]}
            mobile={{
              lead: () => <Glyph icon="repeat" />,
              title: (r) => `${r.from.account} → ${r.to.account}`,
              sub: (r) => (
                <>
                  {formatDate(r.from.date)}
                  <UnlinkButton pair={r.pair} disabled={pending} onUnlink={(id) => run(() => unlinkTransfer(id))} />
                </>
              ),
              amount: (r) => <Money value={r.from.amount} kind="neutral" />,
            }}
          />
        )}
      </Card>
    </div>
  );
}

function UnlinkButton({
  pair,
  disabled,
  onUnlink,
}: {
  pair: LinkedPair;
  disabled: boolean;
  onUnlink: (id: number) => void;
}) {
  return (
    <IconButton
      icon="unlink"
      label="Unlink this transfer"
      size="sm"
      disabled={disabled}
      onClick={() => onUnlink(pair.a.id)}
      className="hover:!text-over"
    />
  );
}

/** One side of a linked transfer: the account, with the bank's description under it. */
function Side({ t }: { t: TxnLite }) {
  return (
    <div className="min-w-0" title={`${t.account} · ${formatDate(t.date)} · ${t.description}`}>
      <div className="truncate">{t.account}</div>
      <div className="max-w-[18rem] truncate text-xs text-fg-3">{t.description}</div>
    </div>
  );
}

/** A suggested pair: From → To, amount, and how far apart the two sides landed. */
function Pair({ from, to, note }: { from: TxnLite; to: TxnLite; note: string }) {
  const full = (t: TxnLite) =>
    `${t.direction} ${formatMoney(t.amount)} · ${t.account} · ${formatDate(t.date)} · ${t.description}`;
  return (
    <div className="flex min-w-0 flex-1 basis-72 items-center gap-3" title={`${full(from)}\n${full(to)}`}>
      <Glyph icon="repeat" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {from.account} <span className="text-fg-3">→</span> {to.account}
        </div>
        <div className="truncate text-xs text-fg-3">
          {formatDate(from.date)} · {note} · {from.description}
        </div>
      </div>
      <Money value={from.amount} kind="neutral" className="shrink-0 font-medium" />
    </div>
  );
}

/** A single flagged transaction waiting for its other side. */
function Single({ t }: { t: TxnLite }) {
  const credit = t.direction === "Credit";
  return (
    <div
      className="flex min-w-0 flex-1 basis-72 items-center gap-3"
      title={`${t.direction} ${formatMoney(t.amount)} · ${t.account} · ${formatDate(t.date)} · ${t.description}`}
    >
      <Glyph icon={credit ? "arrow-down-right" : "arrow-up-right"} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{t.description}</div>
        <div className="truncate text-xs text-fg-3">
          {t.account} · {formatDate(t.date)}
        </div>
      </div>
      <Money value={credit ? t.amount : -t.amount} className="shrink-0 font-medium" />
    </div>
  );
}
