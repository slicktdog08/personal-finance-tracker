"use client";

import { useState, useTransition } from "react";
import {
  convertTransactionToBill,
  linkTransactionToExistingBill,
} from "@/server/actions/transactions";
import { dismissSuggestion } from "@/server/actions/suggestions";
import { Button, Card, Glyph, Icon, Money, Select } from "@/components/ds";
import { billIcon } from "./billGlyph";
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
    <Card
      title="Suggested recurring bills"
      icon={<Icon name="sparkles" size={16} className="text-accent-text" />}
      meta={`${suggestions.length}`}
    >
      <p className="mb-1 text-sm text-fg-2">
        Charges that repeat monthly but aren’t linked to a bill yet. Creating or linking one also links
        every matching transaction across months.
      </p>
      <div>
        {suggestions.map((s) => (
          <SuggestionRow key={s.key} s={s} bills={bills} />
        ))}
      </div>
    </Card>
  );
}

function SuggestionRow({ s, bills }: { s: RecurringSuggestion; bills: BillOpt[] }) {
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
    });
  }

  function linkExisting(billId: number) {
    start(async () => {
      const res = await linkTransactionToExistingBill(s.sampleTransactionId, billId, "/settings/bills");
      if (!res.ok) {
        alert(res.error);
        return;
      }
    });
  }

  function dismiss() {
    start(async () => {
      await dismissSuggestion(s.key);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-3 last:border-b-0">
      <Glyph icon={billIcon(name)} />
      <div className="min-w-[12rem] flex-1 space-y-0.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
          aria-label="Bill name"
          title="Edit the bill name before creating"
          className="w-full rounded-chip border border-transparent bg-transparent px-1.5 py-0.5 -mx-1.5 font-medium text-fg outline-none hover:border-line-2 focus:border-accent"
        />
        <div className="text-xs text-fg-3 tnum">
          <Money value={s.avgAmount} kind="neutral" /> avg · {s.count}× across {s.months} months ·{" "}
          {formatDate(s.firstDate)} – {formatDate(s.lastDate)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon="plus" onClick={createBill} loading={pending} disabled={!name.trim()}>
          Create bill
        </Button>
        {bills.length > 0 && (
          <Select
            value={linkId}
            onChange={(e) => {
              setLinkId(e.target.value);
              if (e.target.value) linkExisting(Number(e.target.value));
            }}
            disabled={pending}
            aria-label="Link to an existing bill"
            className="h-9 w-auto max-w-44 text-sm"
            options={[{ value: "", label: "Link to existing…" }, ...bills.map((b) => ({ value: String(b.id), label: b.name }))]}
          />
        )}
        <Button size="sm" variant="ghost" onClick={dismiss} disabled={pending}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
