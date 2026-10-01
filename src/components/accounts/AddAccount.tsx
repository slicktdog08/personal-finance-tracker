"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACCOUNT_TYPES, LIABILITY_ACCOUNT_TYPES } from "@/constants/enums";
import { createAccount } from "@/server/actions/accounts";

// Cash/other only — credit cards and loans are created on the Debts screen (+ Add debt).
const CASH_TYPE_OPTIONS = ACCOUNT_TYPES.filter((t) => !LIABILITY_ACCOUNT_TYPES.includes(t));

export function AddAccount() {
  const [open, setOpen] = useState(false);
  const [num, setNum] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const inputCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
      >
        + Add account
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={num}
        onChange={(e) => setNum(e.target.value)}
        placeholder="last 4"
        className={inputCls + " w-24"}
      />
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="label"
        className={inputCls}
      />
      <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
        <option value="">type…</option>
        {CASH_TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button
        onClick={() =>
          start(async () => {
            if (!num.trim()) return;
            await createAccount(num.trim(), label || null, type || null);
            setNum("");
            setLabel("");
            setType("");
            setOpen(false);
            router.refresh();
          })
        }
        disabled={pending || !num.trim()}
        className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        Save
      </button>
      <button onClick={() => setOpen(false)} className="text-sm text-neutral-500 hover:underline">
        Cancel
      </button>
    </div>
  );
}
