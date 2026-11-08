"use client";

import { useState, useTransition } from "react";
import { createGoal } from "@/server/actions/goals";
import { EmojiPicker } from "@/components/EmojiPicker";
import { GOAL_TYPES, GOAL_TYPE_META, type GoalType } from "@/constants/enums";
import { Button, Field, Input, Select } from "@/components/ds";
import { Sheet } from "@/components/ui/Sheet";

export interface AcctOption {
  id: number;
  label: string | null;
  accountNumber: string;
  accountType: string | null;
}

export const acctOptionLabel = (a: AcctOption) =>
  `${a.label ?? "••" + a.accountNumber}${a.accountType ? ` (${a.accountType})` : ""}`;

/** Funding-account choices for a Select, with an explicit "none". */
export const acctSelectOptions = (accounts: AcctOption[]) => [
  { value: "", label: "None" },
  ...accounts.map((a) => ({ value: String(a.id), label: acctOptionLabel(a) })),
];

const num = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isNaN(n) ? null : n;
};

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

  const reset = () => {
    setName("");
    setTarget("");
    setTargetDate("");
    setAcct("");
    setEmoji(null);
    setGoalType("savings");
    setErr(null);
  };
  const close = () => {
    setOpen(false);
    setErr(null);
  };

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
      reset();
      setOpen(false);
    });

  return (
    <>
      <Button icon="plus" onClick={() => setOpen(true)}>
        New goal
      </Button>
      <Sheet
        open={open}
        onClose={close}
        title="New goal"
        footer={
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button icon="plus" onClick={save} loading={pending} disabled={!name.trim()}>
              Create goal
            </Button>
          </div>
        }
      >
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field label="Name" className="col-span-2">
            <div className="flex items-center gap-2">
              <EmojiPicker value={emoji ?? GOAL_TYPE_META[goalType as GoalType]?.emoji} onSelect={setEmoji} title="Pick an icon" />
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setErr(null);
                }}
                placeholder="Emergency fund"
                autoFocus
                className="min-w-0 flex-1"
              />
            </div>
          </Field>
          <Field label="Type">
            <Select value={goalType} onChange={(e) => setGoalType(e.target.value)} options={GOAL_TYPES.map((t) => ({ value: t, label: GOAL_TYPE_META[t].label }))} />
          </Field>
          <Field label="Target" error={err}>
            <Input
              money
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setErr(null);
              }}
              placeholder="5000"
              invalid={!!err}
            />
          </Field>
          <Field label="Target date" hint="Optional">
            <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </Field>
          <Field label="Funding account" hint="Optional — we'll flag it if it dips below the goal">
            <Select value={acct} onChange={(e) => setAcct(e.target.value)} options={acctSelectOptions(accounts)} />
          </Field>
          <button type="submit" hidden />
        </form>
      </Sheet>
    </>
  );
}
