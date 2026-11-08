"use client";

import { useState, useTransition } from "react";
import { Button, Field, Input, Sheet } from "@/components/ds";
import { addInstanceNamed } from "@/server/actions/bills";

/**
 * "Add bill" for the month page header. Typing a name that matches an existing recurring bill reuses
 * that bill (addInstanceNamed matches case-insensitively), so dropping and re-adding a bill keeps one
 * history instead of starting a duplicate.
 */
export function AddBillButton({
  periodId,
  path,
  billNames,
}: {
  periodId: number;
  path: string;
  billNames: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const trimmed = name.trim();
  const reuses = trimmed && billNames.some((b) => b.name.toLowerCase() === trimmed.toLowerCase());

  function add() {
    if (!trimmed) return;
    start(async () => {
      await addInstanceNamed(periodId, trimmed, path);
      setName("");
      setOpen(false);
    });
  }

  return (
    <>
      <Button icon="plus" onClick={() => setOpen(true)}>
        Add bill
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Add a bill">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Field
            label="Name"
            htmlFor="add-bill-name"
            hint={reuses ? "Matches a recurring bill — its history carries over." : "Type to reuse an existing bill, or enter a new name."}
          >
            <Input
              id="add-bill-name"
              list="add-bill-names"
              autoFocus
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Spotify"
            />
          </Field>
          <datalist id="add-bill-names">
            {billNames.map((b) => (
              <option key={b.id} value={b.name} />
            ))}
          </datalist>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" icon="plus" loading={pending} disabled={!trimmed}>
              Add bill
            </Button>
          </div>
        </form>
      </Sheet>
    </>
  );
}
