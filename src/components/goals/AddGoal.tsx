"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGoal } from "@/server/actions/goals";
import { EmojiPicker } from "@/components/EmojiPicker";
import { GOAL_TYPES, GOAL_TYPE_META, type GoalType } from "@/constants/enums";

export interface AcctOption {
  id: number;
  label: string | null;
  accountNumber: string;
  accountType: string | null;
}

export const acctOptionLabel = (a: AcctOption) =>
  `${a.label ?? "••" + a.accountNumber}${a.accountType ? ` (${a.accountType})` : ""}`;

export function AddGoal({ accounts }: { accounts: AcctOption[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [goalType, setGoalType] = useState<string>("savings");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [acct, setAcct] = useState("");
  const [emoji, setEmoji] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const inputCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";
  const num = (s: string) => {
    const n = Number(s.replace(/[$,\s]/g, ""));
    return Number.isNaN(n) ? null : n;
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
      >
        + New goal
      </button>
    );
  }

  const save = () =>
    start(async () => {
      const amt = num(target);
      if (!name.trim()) return setErr("Enter a name");
      if (amt == null || amt <= 0) return setErr("Enter a target amount greater than 0");
      const r = await createGoal({
        name: name.trim(),
        goalType,
        targetAmount: amt,
        targetDate: targetDate || null,
        fundingAccountId: acct ? Number(acct) : null,
        emoji,
      });
      if (!r.ok) return setErr(r.error ?? "Failed");
      setName("");
      setTarget("");
      setTargetDate("");
      setAcct("");
      setEmoji(null);
      setGoalType("savings");
      setOpen(false);
      router.refresh();
    });

  return (
    <div className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Icon">
          <EmojiPicker
            value={emoji ?? GOAL_TYPE_META[goalType as GoalType]?.emoji}
            onSelect={setEmoji}
          />
        </Field>
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setErr(null);
            }}
            placeholder="Emergency fund"
            autoFocus
            className={inputCls + " w-56"}
          />
        </Field>
        <Field label="Type">
          <select
            value={goalType}
            onChange={(e) => setGoalType(e.target.value)}
            className={inputCls}
          >
            {GOAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {GOAL_TYPE_META[t].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Target">
          <input
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setErr(null);
            }}
            placeholder="5000"
            inputMode="decimal"
            className={inputCls + " w-28"}
          />
        </Field>
        <Field label="Target date (optional)">
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Funding account (optional)">
          <select value={acct} onChange={(e) => setAcct(e.target.value)} className={inputCls + " max-w-52"}>
            <option value="">— none —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {acctOptionLabel(a)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={pending || !name.trim()}
          className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          Create goal
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setErr(null);
          }}
          className="text-sm text-neutral-500 hover:underline"
        >
          Cancel
        </button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</label>
      {children}
    </div>
  );
}
