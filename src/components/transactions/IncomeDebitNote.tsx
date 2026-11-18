"use client";

import { Icon } from "@/components/ds";
import { incomeDebitWarning } from "@/server/lib/payday-reconcile";

type Row = { direction: string; category?: string | null; description?: string | null };

/**
 * Form-side nudge: the row reads as income but the Direction is Debit. A warning, not a block —
 * saving is still allowed, since a reversed paycheck really is money out.
 */
export function IncomeDebitNote({ row, onSwitch }: { row: Row; onSwitch: () => void }) {
  const msg = incomeDebitWarning(row);
  if (!msg) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-panel bg-warn-soft px-3 py-2 text-xs text-warn">
      <Icon name="triangle-alert" size={14} className="mt-px shrink-0" />
      <div className="space-y-1">
        <p className="leading-snug">{msg}</p>
        <button type="button" onClick={onSwitch} className="font-semibold underline hover:no-underline">
          Switch to Credit
        </button>
      </div>
    </div>
  );
}

/** Table-side marker for a saved row with the same mismatch. */
export function IncomeDebitBadge({ row }: { row: Row }) {
  const msg = incomeDebitWarning(row);
  if (!msg) return null;
  return (
    <span title={msg} className="mp-badge mp-badge--sm inline-flex items-center gap-1 !bg-warn-soft !text-warn">
      <Icon name="triangle-alert" size={11} />
      Debit?
    </span>
  );
}
