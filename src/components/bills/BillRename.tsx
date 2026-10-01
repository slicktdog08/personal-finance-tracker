"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBill } from "@/server/actions/bills";

export function BillRename({ id, name }: { id: number; name: string }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!editing) {
    return (
      <button
        onClick={() => {
          setVal(name);
          setEditing(true);
        }}
        className="text-sm text-blue-600 hover:underline"
      >
        Rename
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700"
        autoFocus
      />
      <button
        onClick={() =>
          start(async () => {
            const n = val.trim();
            if (n) await updateBill(id, { name: n });
            setEditing(false);
            router.refresh();
          })
        }
        disabled={pending || !val.trim()}
        className="px-2 py-1 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        Save
      </button>
      <button
        onClick={() => setEditing(false)}
        className="text-xs text-neutral-500 hover:underline"
      >
        Cancel
      </button>
    </span>
  );
}
