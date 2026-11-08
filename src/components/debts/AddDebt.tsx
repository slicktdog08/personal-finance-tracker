"use client";

import { useState, useTransition } from "react";
import { createLiabilityAccount } from "@/server/actions/accounts";
import { Button, Field, Input, Segmented } from "@/components/ds";
import { Sheet } from "@/components/ui/Sheet";

// `existingBills` = names of recurring bills, offered as type-ahead suggestions so a new
// liability can adopt a bill's name (and link to it for payment attribution) — or just type a
// brand-new name. `type` picks Credit card (revolving, has a limit) vs Loan (installment).
export function AddDebt({ existingBills }: { existingBills: string[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"Credit" | "Loan">("Credit");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const close = () => {
    setOpen(false);
    setName("");
    setErr(null);
  };
  const save = () =>
    start(async () => {
      const r = await createLiabilityAccount(name, type);
      if (!r.ok) {
        setErr(r.error ?? "Failed");
        return;
      }
      close();
    });

  return (
    <>
      <Button icon="plus" onClick={() => setOpen(true)}>
        Add debt
      </Button>
      <Sheet
        open={open}
        onClose={close}
        title="Add debt"
        footer={
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button icon="plus" onClick={save} loading={pending} disabled={!name.trim()}>
              Add debt
            </Button>
          </div>
        }
      >
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save();
          }}
        >
          <Field label="Name" hint="Pick a bill to link its payments, or type a new name." error={err}>
            <Input
              list="debt-bill-names"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErr(null);
              }}
              placeholder="Car loan"
              autoFocus
              invalid={!!err}
            />
            <datalist id="debt-bill-names">
              {existingBills.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </Field>
          <Field label="Type">
            <Segmented<"Credit" | "Loan">
              block
              label="Type"
              value={type}
              onChange={setType}
              options={[
                { value: "Credit", label: "Credit card" },
                { value: "Loan", label: "Loan" },
              ]}
            />
          </Field>
        </form>
      </Sheet>
    </>
  );
}
