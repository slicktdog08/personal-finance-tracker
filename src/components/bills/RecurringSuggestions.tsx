"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  convertTransactionToBill,
  linkTransactionToExistingBill,
} from "@/server/actions/transactions";
import { dismissSuggestion } from "@/server/actions/suggestions";
import { formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import type { RecurringSuggestion } from "@/server/queries";

interface BillOpt {
  id: number;
  name: string;
}

// Bills-screen panel: charges that repeat monthly but aren't linked to a bill.
// Each row lets you create a bill (rename first if you like), link the group to an
// existing bill, or dismiss it — all of which link every matching transaction.
export function RecurringSuggestions({
  suggestions,
  bills,
}: {
  suggestions: RecurringSuggestion[];
  bills: BillOpt[];
}) {
  if (suggestions.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Suggested recurring bills</h2>
        <p className="text-sm text-neutral-500">
          Charges that repeat monthly but aren’t linked to a bill yet. Creating or linking one also
          links every matching transaction across months.
        </p>
      </div>
      <div className="rounded-lg border border-amber-300/70 dark:border-amber-800/50 divide-y divide-neutral-200 dark:divide-neutral-800 overflow-hidden">
        {suggestions.map((s) => (
          <SuggestionRow key={s.key} s={s} bills={bills} />
        ))}
      </div>
    </section>
  );
}

function SuggestionRow({ s, bills }: { s: RecurringSuggestion; bills: BillOpt[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(s.name);
  const [linkId, setLinkId] = useState("");

  function createBill() {
    const n = name.trim();
    if (!n) return;
    start(async () => {
      const res = await convertTransactionToBill(s.sampleTransactionId, n, "/settings/bills");
      if (!res.ok) {
        alert(res.error);
        return;
      }
      router.refresh();
    });
  }

  function linkExisting(billId: number) {
    start(async () => {
      const res = await linkTransactionToExistingBill(s.sampleTransactionId, billId, "/settings/bills");
      if (!res.ok) {
        alert(res.error);
        return;
      }
      router.refresh();
    });
  }

  function dismiss() {
    start(async () => {
      await dismissSuggestion(s.key);
      router.refresh();
    });
  }

  const selectCls =
    "border rounded px-2 py-1 text-xs bg-transparent border-neutral-300 dark:border-neutral-700 max-w-40";

  return (
    <div className="p-3 flex flex-wrap items-center gap-3 bg-amber-50/40 dark:bg-amber-950/10">
      <div className="flex-1 min-w-[200px] space-y-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
          title="Edit the bill name before creating"
          className="w-full bg-transparent border-b border-transparent hover:border-neutral-300 dark:hover:border-neutral-700 focus:border-blue-500 outline-none text-sm font-medium"
        />
        <div className="text-xs text-neutral-500 tabular-nums">
          {formatMoney(s.avgAmount)} avg · {s.count}× across {s.months} months · {formatDate(s.firstDate)}
          {" – "}
          {formatDate(s.lastDate)}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={createBill}
          disabled={pending || !name.trim()}
          className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Create bill"}
        </button>
        {bills.length > 0 && (
          <select
            value={linkId}
            onChange={(e) => {
              setLinkId(e.target.value);
              if (e.target.value) linkExisting(Number(e.target.value));
            }}
            disabled={pending}
            className={selectCls}
          >
            <option value="">Link to existing…</option>
            {bills.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={dismiss}
          disabled={pending}
          className="text-xs text-neutral-500 hover:underline disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
