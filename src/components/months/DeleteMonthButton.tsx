"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ds";
import { deletePeriod } from "@/server/actions/periods";

/**
 * Deletes a month from its own page. The server action is the gate (transactions, this month and
 * next); this only explains what goes with it before asking, and disables itself when the month
 * still has transactions so the refusal isn't a surprise.
 */
export function DeleteMonthButton({
  periodId,
  pretty,
  billCount,
  txnCount,
}: {
  periodId: number;
  pretty: string;
  billCount: number;
  txnCount: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const blocked = txnCount > 0;

  function onClick() {
    const what = billCount ? `its ${billCount} bill${billCount === 1 ? "" : "s"} and budget` : "its budget, if any";
    if (!confirm(`Delete ${pretty}?\n\nThis removes the month along with ${what}. The bills themselves are kept for other months.`)) return;
    setError(null);
    start(async () => {
      const res = await deletePeriod(periodId);
      if (!res.ok) setError(res.error);
      else router.push("/dashboard");
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        icon="trash-2"
        onClick={onClick}
        loading={pending}
        disabled={blocked}
        title={blocked ? `Has ${txnCount} transaction${txnCount === 1 ? "" : "s"} — move or delete them first` : undefined}
        className="text-over disabled:opacity-40"
      >
        {pending ? "Deleting…" : "Delete month"}
      </Button>
      {error && <p className="max-w-xs text-right text-xs text-over">{error}</p>}
    </div>
  );
}
