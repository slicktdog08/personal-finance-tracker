"use client";

import { useState, useTransition } from "react";
import { ColorSelect, type ColorOption } from "@/components/ColorSelect";
import { Notice } from "@/components/ds";
import { updateBill } from "@/server/actions/bills";

/**
 * Which budget envelope this bill draws from.
 *
 * Why it matters enough to be its own control: the cash projection nets a bill against the
 * category line that already plans for it, so the same money isn't both paid as a bill AND spread
 * as everyday spending. It used to find that line by guessing from the bill's linked transactions
 * — which a brand-new bill has none of, so rent and a new utility were each counted twice and a
 * budget that nets to zero projected a $1,575/month loss. Setting this makes the link explicit.
 */
export function BillCategory({
  id,
  category,
  inherited,
  options,
}: {
  id: number;
  /** The bill's own setting; null means "fall back to guessing". */
  category: string | null;
  /** What the guess currently produces, shown when nothing is set. */
  inherited: string | null;
  /** Categories are colored, so this is the in-place color picker rather than a plain select. */
  options: ColorOption[];
}) {
  const [val, setVal] = useState(category ?? "");
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  const commit = (next: string) => {
    setVal(next);
    setSaved(false);
    start(async () => {
      await updateBill(id, { category: next || null });
      setSaved(true);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <ColorSelect
          value={val}
          options={options}
          allowEmpty
          disabled={pending}
          placeholder={inherited ? `Guess: ${inherited}` : "Not set"}
          onSelect={commit}
        />
        {!val && <span className="text-xs text-fg-3">{inherited ? "Guessed from linked transactions" : "Counts as unbudgeted"}</span>}
        {pending && <span className="text-xs text-fg-3">Saving…</span>}
        {saved && !pending && <span className="text-xs text-income">Saved</span>}
      </div>
      <p className="max-w-prose text-xs text-fg-3">
        The budget envelope this bill is paid out of. The projection subtracts the bill on its due
        day and takes the same amount off this envelope, so it isn&apos;t counted twice. Leave it
        unset only for a bill that genuinely has no envelope — that money then shows as unbudgeted
        outflow.
      </p>
      {!category && !inherited && (
        <Notice tone="warn">
          Nothing set and no transaction history to guess from, so this bill is currently double
          counted against whichever envelope plans for it.
        </Notice>
      )}
    </div>
  );
}
