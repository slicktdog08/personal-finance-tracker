"use client";

import { useState, useTransition } from "react";
import { changeAccountNumber } from "@/server/actions/accounts";
import { Button, Field, Input, Sheet } from "@/components/ds";

/** Old statements keep working after a number change only when the old number was a real one. */
export const keepsOldNumber = (accountNumber: string) => /^\d+$/.test(accountNumber);

export const NUMBER_HINT = "How imports and bank sync recognize this account.";

/** Change the number an account is recognized by. Explicit save — this is the account's key. */
export function ChangeNumberSheet({
  account,
  onClose,
}: {
  account: { id: number; accountNumber: string; name: string };
  onClose: () => void;
}) {
  const [num, setNum] = useState(account.accountNumber);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const changed = num.trim() !== "" && num.trim() !== account.accountNumber;

  const save = () => {
    if (!changed) return;
    start(async () => {
      const res = await changeAccountNumber(account.id, num);
      if (res.ok) onClose();
      else setError(res.error);
    });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Change account number"
      desktop="centered"
      width={420}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="check" onClick={save} loading={pending} disabled={!changed || pending}>
            Change number
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
        <p className="text-sm text-fg-2">
          {account.name} <span className="font-mono">··{account.accountNumber}</span>
        </p>
        <Field label="Last four" htmlFor="renumber" hint={NUMBER_HINT} error={error}>
          <Input
            id="renumber"
            value={num}
            maxLength={8}
            autoFocus
            invalid={!!error}
            onChange={(e) => {
              setNum(e.target.value);
              setError(null);
            }}
          />
        </Field>
        {changed && keepsOldNumber(account.accountNumber) && (
          <p className="text-xs text-fg-3">
            Statements that still say ··{account.accountNumber} will keep importing into this account.
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
