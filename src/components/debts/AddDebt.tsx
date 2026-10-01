"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLiabilityAccount } from "@/server/actions/accounts";

// `existingBills` = names of recurring bills, offered as type-ahead suggestions so a new
// liability can adopt a bill's name (and link to it for payment attribution) — or just type a
// brand-new name. `type` picks Credit card (revolving, has a limit) vs Loan (installment).
export function AddDebt({ existingBills }: { existingBills: string[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"Credit" | "Loan">("Credit");
  const [err, setErr] = useState<string | null>(null);
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
        + Add debt
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        list="debt-bill-names"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setErr(null);
        }}
        placeholder="name (e.g. Car Loan) or pick a bill"
        autoFocus
        className={inputCls + " min-w-64"}
      />
      <datalist id="debt-bill-names">
        {existingBills.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <select
        value={type}
        onChange={(e) => setType(e.target.value as "Credit" | "Loan")}
        className={inputCls}
      >
        <option value="Credit">Credit card</option>
        <option value="Loan">Loan</option>
      </select>
      <button
        onClick={() =>
          start(async () => {
            const r = await createLiabilityAccount(name, type);
            if (!r.ok) {
              setErr(r.error ?? "Failed");
              return;
            }
            setName("");
            setOpen(false);
            router.refresh();
          })
        }
        disabled={pending || !name.trim()}
        className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        Save
      </button>
      <button
        onClick={() => {
          setOpen(false);
          setName("");
          setErr(null);
        }}
        className="text-sm text-neutral-500 hover:underline"
      >
        Cancel
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
