"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergeBills } from "@/server/actions/bills";

export function BillMerge({
  currentId,
  currentName,
  others,
}: {
  currentId: number;
  currentName: string;
  others: { id: number; name: string }[];
}) {
  const [sel, setSel] = useState<number | "">("");
  const [pending, start] = useTransition();
  const router = useRouter();

  function doMerge() {
    if (sel === "") return;
    const other = others.find((o) => o.id === sel);
    if (!other) return;
    if (
      !confirm(
        `Merge "${other.name}" INTO "${currentName}"?\n\nAll of "${other.name}"'s monthly entries will be reassigned to "${currentName}", and "${other.name}" will be deleted. This cannot be undone.`,
      )
    )
      return;
    start(async () => {
      await mergeBills(Number(sel), currentId, `/settings/bills/${currentId}`);
      setSel("");
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 space-y-2">
      <div className="font-medium text-sm">Consolidate duplicate bills</div>
      <p className="text-xs text-neutral-500">
        If this bill got split into separate entities (e.g. dropped and re-added), merge the
        duplicate into this one. The other bill&apos;s history moves here.
      </p>
      <div className="flex items-center gap-2">
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value === "" ? "" : Number(e.target.value))}
          className="border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700 flex-1"
        >
          <option value="">— select a bill to merge in —</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <button
          onClick={doMerge}
          disabled={sel === "" || pending}
          className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
        >
          {pending ? "Merging…" : "Merge in"}
        </button>
      </div>
    </div>
  );
}
