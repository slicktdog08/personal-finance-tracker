"use client";

import { useState, useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/Sheet";
import {
  previewBillConversion,
  convertTransactionToBill,
  linkTransactionToExistingBill,
  setTransactionBill,
  type MatchCandidate,
} from "@/server/actions/transactions";
import { formatDate } from "@/server/lib/period";
import { formatMoney } from "@/server/lib/money";

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
// Once linked, the row shows which bill it belongs to and offers Unlink.
export function ConvertToBill({
  transactionId,
  description,
  billId,
  bills,
  path = "/transactions",
}: {
  transactionId: number;
  description: string;
  billId: number | null;
  bills: BillOption[];
  path?: string;
}) {
  const router = useRouter();
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
  const btnRef = useRef<HTMLButtonElement>(null);

  function openPanel() {
    setMode("new");
    setName(description);
    setExistingId("");
    setMatches([]);
    setChosen(new Set());
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
        router.refresh();
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
      if (res.ok) router.refresh();
      else alert(res.error);
    });
  }

  const canSubmit =
    !pending && !loading && (mode === "new" ? name.trim().length > 0 : existingId !== "");

  // Already attributed to a bill — show which one, and a way out.
  if (billId != null) {
    const bill = bills.find((b) => b.id === billId);
    return (
      <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
        <Link
          href={`/settings/bills/${billId}`}
          className="text-neutral-500 hover:underline max-w-[10rem] truncate"
          title={bill ? `Linked to ${bill.name}` : "Linked to a bill"}
        >
          {bill?.name ?? "Linked"}
        </Link>
        <button
          onClick={unlink}
          disabled={pending}
          title="Unlink from this bill"
          className="text-neutral-400 hover:text-red-600 hover:underline disabled:opacity-50"
        >
          Unlink
        </button>
      </span>
    );
  }

  const inputCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700 w-full";
  const tabCls = (active: boolean) =>
    `flex-1 px-2 py-1 text-xs font-medium rounded ${
      active
        ? "bg-blue-600 text-white"
        : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
    }`;
  const pickCls = "text-blue-600 hover:underline disabled:opacity-50 disabled:no-underline";

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
        <div className="flex gap-1 rounded-md border border-neutral-200 dark:border-neutral-800 p-0.5">
          <button className={tabCls(mode === "new")} onClick={() => setMode("new")}>
            New bill
          </button>
          <button
            className={tabCls(mode === "existing")}
            onClick={() => setMode("existing")}
            disabled={bills.length === 0}
            title={bills.length === 0 ? "No bills yet" : undefined}
          >
            Existing bill
          </button>
        </div>

        {mode === "new" ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">Bill name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              autoFocus
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">Link to bill</span>
            <select
              value={existingId}
              onChange={(e) => setExistingId(e.target.value)}
              className={inputCls}
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
          <p className="text-xs text-neutral-500">Checking for other occurrences…</p>
        ) : matches.length === 0 ? (
          <p className="text-xs text-neutral-500">No other matching transactions found.</p>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-neutral-500">
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
            <ul className="max-h-40 overflow-y-auto rounded border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800 text-xs">
              {matches.map((m) => (
                <li key={m.id}>
                  <label
                    className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900"
                    title={m.description}
                  >
                    <input
                      type="checkbox"
                      checked={chosen.has(m.id)}
                      onChange={() => toggle(m.id)}
                      className="shrink-0"
                    />
                    <span className="tabular-nums text-neutral-500 whitespace-nowrap">
                      {formatDate(m.txnDate)}
                    </span>
                    <span
                      className={`ml-auto tabular-nums whitespace-nowrap ${
                        m.direction === "Credit" ? "text-emerald-700 dark:text-emerald-400" : ""
                      }`}
                    >
                      {formatMoney(m.amount)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-neutral-400">
              Untick any that belong to a different bill — you can link those separately, or
              unlink later from the row or the bill page.
            </p>
          </div>
        )}
        <p className="text-[11px] text-neutral-400">
          {loading
            ? ""
            : recent
              ? "Adds this bill to the current month and links the transaction. Nothing is changed retroactively."
              : `Last seen ${lastSeen ? formatDate(lastSeen) : "a while ago"}, so it won't be added to the current month — the transactions are still linked.`}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={() => setOpen(false)}
            className="px-3 py-1.5 text-sm text-neutral-500 hover:underline"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
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
        className="text-xs text-blue-600 hover:underline disabled:opacity-50"
      >
        To bill
      </button>
      {panel}
    </>
  );
}
