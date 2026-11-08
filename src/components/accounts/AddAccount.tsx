"use client";

import { useState, useTransition } from "react";
import { ACCOUNT_TYPES, LIABILITY_ACCOUNT_TYPES } from "@/constants/enums";
import { createAccount } from "@/server/actions/accounts";
import { Button, Field, Input, Select, Sheet } from "@/components/ds";

// Cash/other only — credit cards and loans are created on the Debts screen (+ Add debt).
const CASH_TYPE_OPTIONS = ACCOUNT_TYPES.filter((t) => !LIABILITY_ACCOUNT_TYPES.includes(t));

export function AddAccount() {
  const [open, setOpen] = useState(false);
  const [num, setNum] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState("");
  const [pending, start] = useTransition();

  const close = () => setOpen(false);
  const save = () =>
    start(async () => {
      if (!num.trim()) return;
      await createAccount(num.trim(), label || null, type || null);
      setNum("");
      setLabel("");
      setType("");
      setOpen(false);
    });

  return (
    <>
      <Button icon="plus" onClick={() => setOpen(true)}>
        Add account
      </Button>
      <Sheet
        open={open}
        onClose={close}
        title="Add account"
        desktop="centered"
        width={420}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button icon="check" onClick={save} loading={pending} disabled={pending || !num.trim()}>
              Add account
            </Button>
          </div>
        }
      >
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field label="Last four" htmlFor="new-acct-num" hint="How imports and bank sync recognize this account.">
            <Input id="new-acct-num" value={num} onChange={(e) => setNum(e.target.value)} placeholder="e.g. 4381" autoFocus />
          </Field>
          <Field label="Label" htmlFor="new-acct-label">
            <Input id="new-acct-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Schwab Checking" />
          </Field>
          <Field label="Type" htmlFor="new-acct-type" hint="Credit cards and loans are added on Debts.">
            <Select
              id="new-acct-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              options={[{ value: "", label: "Not set" }, ...CASH_TYPE_OPTIONS.map((t) => t as string)]}
            />
          </Field>
          {/* Enter in any field submits. */}
          <button type="submit" hidden />
        </form>
      </Sheet>
    </>
  );
}
