"use client";

import { useState, useTransition } from "react";
import { Button, Input } from "@/components/ds";
import { updateBill } from "@/server/actions/bills";

export function BillRename({ id, name }: { id: number; name: string }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name);
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <Button
        variant="secondary"
        size="sm"
        icon="pencil"
        onClick={() => {
          setVal(name);
          setEditing(true);
        }}
      >
        Rename
      </Button>
    );
  }

  const save = () =>
    start(async () => {
      const n = val.trim();
      if (n) await updateBill(id, { name: n });
      setEditing(false);
    });

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Input value={val} onChange={(e) => setVal(e.target.value)} aria-label="Bill name" autoFocus className="w-56" />
      <Button type="submit" size="sm" loading={pending} disabled={!val.trim()}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </form>
  );
}
