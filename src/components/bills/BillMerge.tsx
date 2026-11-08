"use client";

import { useState, useTransition } from "react";
import { Button, Card, Icon, Select } from "@/components/ds";
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
    });
  }

  return (
    <Card title="Consolidate duplicate bills" icon={<Icon name="merge" size={16} className="text-fg-3" />}>
      <p className="mb-3 text-sm text-fg-2">
        If this bill got split into separate entries (say, dropped and re-added), merge the duplicate
        into this one. The other bill&apos;s history moves here.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={sel === "" ? "" : String(sel)}
          onChange={(e) => setSel(e.target.value === "" ? "" : Number(e.target.value))}
          aria-label="Bill to merge in"
          className="min-w-0 flex-1 basis-56"
          options={[{ value: "", label: "Choose a bill to merge in" }, ...others.map((o) => ({ value: String(o.id), label: o.name }))]}
        />
        <Button variant="secondary" icon="merge" onClick={doMerge} disabled={sel === ""} loading={pending}>
          {pending ? "Merging…" : "Merge in"}
        </Button>
      </div>
    </Card>
  );
}
