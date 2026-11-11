"use client";

import { useState, useRef, useTransition } from "react";
import Link from "next/link";
import { Sheet } from "@/components/ui/Sheet";
import { Icon, Money } from "@/components/ds";
import {
  previewBillConversion,
  convertTransactionToBill,
  linkTransactionToExistingBill,
  setTransactionBill,
  type MatchCandidate,
} from "@/server/actions/transactions";
import { formatDate } from "@/server/lib/period";
import { ruleSeedPattern, type RuleInput } from "@/server/lib/categorize";
import type { CategoryOption } from "@/server/queries";
import { RuleEditor } from "@/components/transactions/RuleEditor";

export interface BillOption {
  id: number;
  name: string;
}

// Per-row "Convert to bill" / "Link to bill" action. Opens a Sheet (bottom
// sheet on mobile, anchored popover on desktop) offering two modes — create a
// new bill, or link to an existing one. Other occurrences of the same merchant
// are listed with checkboxes so you confirm exactly which ones belong: the same
// statement line can cover two different bills (two cards paid through one
// lender), so nothing is linked without being shown first.
//
// Once linked, the row shows which bill it belongs to and offers Unlink — plus, for a link made
// by hand, "auto-link future payments like this", which opens the rule editor prefilled.
export function ConvertToBill({
  transactionId,
  description,
  billId,
  billRuleId = null,
  txn,
  categoryOptions = [],
  bills,
  path = "/transactions",
  actionOnly = false,
}: {
  /** The row-actions copy: never shows the linked badge, but stays mounted after linking so the
   *  "auto-link future payments" editor it opens survives the row turning linked. */
  actionOnly?: boolean;
  transactionId: number;
  description: string;
  billId: number | null;
  /** The saved rule that made this link (null = linked by hand). */
  billRuleId?: number | null;
  /** What a rule made from this row should be scoped by. */
  txn?: { accountId: number | null; amount: string | null; direction: string };
  categoryOptions?: CategoryOption[];
  bills: BillOption[];
  path?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState(description);
  const [existingId, setExistingId] = useState<string>("");
  const [sourceAmount, setSourceAmount] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchCandidate[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [recent, setRecent] = useState(true);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [makeRule, setMakeRule] = useState(false);
  // Set when the rule editor should open, prefilled for this bill.
  const [ruleDraft, setRuleDraft] = useState<Partial<RuleInput> | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const ruleBtnRef = useRef<HTMLButtonElement>(null);

  // A rule seeded from this row: same text, direction and account; pinned to this amount when
  // the user picked "same amount" (two bills sharing one statement line differ by amount).
  function seedRule(forBill: number, exactAmount: boolean): Partial<RuleInput> {
    const amt = txn?.amount != null ? Math.abs(Number(txn.amount)) : null;
    return {
      pattern: ruleSeedPattern(description),
      billId: forBill,
      direction: txn?.direction === "Credit" ? "Credit" : txn?.direction === "Debit" ? "Debit" : null,
      accountId: txn?.accountId ?? null,
      amountMin: exactAmount && amt != null ? amt : null,
      amountMax: exactAmount && amt != null ? amt : null,
    };
  }

  function openPanel() {
    setMode("new");
    setName(description);
    setExistingId("");
    setMatches([]);
    setChosen(new Set());
    setMakeRule(false);
    setLoading(true);
    setOpen(true);
    previewBillConversion(transactionId).then((p) => {
      setLoading(false);
      if (p) {
        setName(p.name);
        setSourceAmount(p.amount);
        setMatches(p.matches);
        // Everything ticked by default — the list is the confirmation step, and
        // the common case is "yes, all of these are this bill".
        setChosen(new Set(p.matches.map((m) => m.id)));
        setRecent(p.recent);
        setLastSeen(p.lastSeen);
      }
    });
  }

  function toggle(id: number) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Quick picks for the ambiguous case: two bills share one statement line and
  // usually differ by amount, so "same amount" is the fastest way to split them.
  const sameAmount = (m: MatchCandidate) =>
    sourceAmount != null && m.amount != null && Number(m.amount) === Number(sourceAmount);
  const sameAmountCount = matches.filter(sameAmount).length;

  function submit() {
    const others = [...chosen];
    start(async () => {
      const res =
        mode === "new"
          ? await convertTransactionToBill(transactionId, name.trim(), path, others)
          : await linkTransactionToExistingBill(transactionId, Number(existingId), path, others);
      if (res.ok) {
        setOpen(false);
        if (makeRule) {
          // "Same amount" picked (some unticked, all ticked share the amount) → pin the amount.
          const picked = matches.filter((m) => chosen.has(m.id));
          const exact = picked.length < matches.length && picked.length > 0 && picked.every(sameAmount);
          setRuleDraft(seedRule(res.billId, exact));
        }
      } else {
        alert(res.error);
      }
    });
  }

  function unlink() {
    const billName = bills.find((b) => b.id === billId)?.name ?? "its bill";
    if (!confirm(`Unlink this transaction from ${billName}? The bill itself is left as-is.`)) return;
    start(async () => {
      const res = await setTransactionBill(transactionId, null, path);
      if (!res.ok) alert(res.error);
    });
  }

  const canSubmit =
    !pending && !loading && (mode === "new" ? name.trim().length > 0 : existingId !== "");

  const ruleEditor = ruleDraft && (
    <RuleEditor
      open
      onClose={() => setRuleDraft(null)}
      anchorRef={billId != null && !actionOnly ? ruleBtnRef : undefined}
      categoryOptions={categoryOptions}
      mode={{ kind: "create", ...ruleDraft }}
      note="Future payments matching this will be linked to the bill automatically. Narrow it by account or amount if another bill shares this statement line."
    />
  );

  if (billId != null && actionOnly) return <>{ruleEditor}</>;

  // Already attributed to a bill — show which one, and a way out.
  if (billId != null) {
    const bill = bills.find((b) => b.id === billId);
    return (
      <span className="inline-flex min-w-0 items-center gap-0.5 whitespace-nowrap">
        <Link
          href={`/settings/bills/${billId}`}
          className="mp-badge mp-badge--outline mp-badge--sm max-w-[11rem] hover:!text-accent-text"
          title={
            (bill ? `Linked to ${bill.name}` : "Linked to a bill") +
            (billRuleId != null ? " automatically, by a saved rule" : "")
          }
        >
          <Icon name={billRuleId != null ? "wand-sparkles" : "link"} size={11} />
          <span className="mp-badge__label">{bill?.name ?? "Linked"}</span>
        </Link>
        {billRuleId == null && txn && (
          <button
            ref={ruleBtnRef}
            onClick={() => setRuleDraft(seedRule(billId, false))}
            disabled={pending}
            title="Auto-link future payments like this one (creates a rule)"
            aria-label="Auto-link future payments like this one"
            className="inline-flex rounded-full p-0.5 text-fg-3 hover:text-accent-text disabled:opacity-50"
          >
            <Icon name="wand-sparkles" size={12} />
          </button>
        )}
        <button
          onClick={unlink}
          disabled={pending}
          title="Unlink from this bill"
          aria-label="Unlink from this bill"
          className="inline-flex rounded-full p-0.5 text-fg-3 hover:text-over disabled:opacity-50"
        >
          <Icon name="unlink" size={12} />
        </button>
        {ruleEditor}
      </span>
    );
  }

  const inputCls =
    "mp-input !h-9";

  const selectCls = "mp-select !h-9";
  const pickCls = "text-accent-text hover:underline disabled:opacity-50 disabled:no-underline";

  const panel = (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title="Convert to bill"
      anchorRef={btnRef}
      desktop="anchored"
      width={336}
    >
      <div className="space-y-2 text-left">
        <div className="mp-seg mp-seg--block" role="group" aria-label="Convert or link">
          <button type="button" aria-pressed={mode === "new"} onClick={() => setMode("new")}>
            New bill
          </button>
          <button
            type="button"
            aria-pressed={mode === "existing"}
            onClick={() => setMode("existing")}
            disabled={bills.length === 0}
            title={bills.length === 0 ? "No bills yet" : undefined}
          >
            Existing bill
          </button>
        </div>

        {mode === "new" ? (
          <div className="flex flex-col gap-1">
            <span className="mp-field__label">Bill name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              autoFocus
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="mp-field__label">Link to bill</span>
            <select
              value={existingId}
              onChange={(e) => setExistingId(e.target.value)}
              className={selectCls}
              autoFocus
            >
              <option value="">— choose a bill —</option>
              {bills.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {loading ? (
          <p className="text-xs text-fg-3">Checking for other occurrences…</p>
        ) : matches.length === 0 ? (
          <p className="text-xs text-fg-3">No other matching transactions found.</p>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-fg-3">
                Also link {chosen.size} of {matches.length} other matching
              </span>
              <span className="flex gap-2 whitespace-nowrap">
                <button
                  className={pickCls}
                  disabled={chosen.size === matches.length}
                  onClick={() => setChosen(new Set(matches.map((m) => m.id)))}
                >
                  All
                </button>
                <button
                  className={pickCls}
                  disabled={chosen.size === 0}
                  onClick={() => setChosen(new Set())}
                >
                  None
                </button>
                {sameAmountCount > 0 && sameAmountCount < matches.length && (
                  <button
                    className={pickCls}
                    title={`Only the ${sameAmountCount} with the same amount as this transaction`}
                    onClick={() =>
                      setChosen(new Set(matches.filter(sameAmount).map((m) => m.id)))
                    }
                  >
                    Same amount
                  </button>
                )}
              </span>
            </div>
            <ul className="max-h-40 overflow-y-auto rounded-control border border-line divide-y divide-line text-xs">
              {matches.map((m) => (
                <li key={m.id}>
                  <label
                    className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-hover"
                    title={m.description}
                  >
                    <input
                      type="checkbox"
                      checked={chosen.has(m.id)}
                      onChange={() => toggle(m.id)}
                      className="shrink-0"
                    />
                    <span className="tabular-nums text-fg-3 whitespace-nowrap">
                      {formatDate(m.txnDate)}
                    </span>
                    <Money
                      className="ml-auto whitespace-nowrap"
                      value={(m.direction === "Credit" ? 1 : -1) * (Number(m.amount) || 0)}
                    />
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-fg-3">
              Untick any that belong to a different bill — you can link those separately, or
              unlink later from the row or the bill page.
            </p>
          </div>
        )}
        <p className="text-[11px] text-fg-3">
          {loading
            ? ""
            : recent
              ? "Adds this bill to the current month and links the transaction. Nothing is changed retroactively."
              : `Last seen ${lastSeen ? formatDate(lastSeen) : "a while ago"}, so it won't be added to the current month — the transactions are still linked.`}
        </p>
        {txn && (
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={makeRule}
              onChange={(e) => setMakeRule(e.target.checked)}
              className="mt-0.5"
            />
            <span>Auto-link future payments like this (opens a rule to review)</span>
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={() => setOpen(false)}
            className="mp-btn mp-btn--ghost mp-btn--sm"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="mp-btn mp-btn--primary mp-btn--sm"
          >
            {pending ? "Saving…" : mode === "new" ? "Convert" : "Link"}
          </button>
        </div>
      </div>
    </Sheet>
  );

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (open ? setOpen(false) : openPanel())}
        disabled={pending}
        title="Convert to a bill or link to an existing one"
        aria-label="Convert to bill"
        className="mp-btn mp-iconbtn mp-btn--ghost mp-btn--sm"
      >
        <Icon name="receipt" size={16} />
      </button>
      {panel}
      {ruleEditor}
    </>
  );
}
