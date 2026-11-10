"use client";

import { useState, useTransition } from "react";
import { ASSET_KINDS, ASSET_KIND_META } from "@/constants/enums";
import { createAsset } from "@/server/actions/assets";
import { Button, Field, Input, Select, Sheet } from "@/components/ds";

const KIND_OPTIONS = ASSET_KINDS.map((k) => ({ value: k, label: ASSET_KIND_META[k].label }));
const today = () => new Date().toISOString().slice(0, 10);
const num = (s: string) => {
  const t = s.replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isNaN(n) ? undefined : n;
};

/** A car, a house — something you own that's worth money but isn't money. */
export function AddAsset() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("vehicle");
  const [value, setValue] = useState("");
  const [asOf, setAsOf] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setName("");
    setKind("vehicle");
    setValue("");
    setAsOf(today());
    setError(null);
  };
  const close = () => {
    setOpen(false);
    reset();
  };
  const save = () =>
    start(async () => {
      const v = num(value);
      if (v === undefined) return setError("Value must be a number");
      const res = await createAsset({ name, kind, value: v, asOf });
      if (!res.ok) return setError(res.error ?? "Couldn't add the asset");
      close();
    });

  return (
    <>
      <Button variant="secondary" icon="plus" onClick={() => setOpen(true)}>
        Add asset
      </Button>
      <Sheet
        open={open}
        onClose={close}
        title="Add asset"
        desktop="centered"
        width={420}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button icon="check" onClick={save} loading={pending} disabled={pending || !name.trim()}>
              Add asset
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
          <Field label="Name" htmlFor="new-asset-name">
            <Input id="new-asset-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Car" autoFocus />
          </Field>
          <Field label="Kind" htmlFor="new-asset-kind">
            <Select id="new-asset-kind" value={kind} onChange={(e) => setKind(e.target.value)} options={KIND_OPTIONS} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="What it's worth" htmlFor="new-asset-value" hint="Resale value, not what you owe on it.">
              <Input id="new-asset-value" money value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="As of" htmlFor="new-asset-asof" hint="Backdate it to start the history earlier.">
              <Input id="new-asset-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </Field>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" hidden />
        </form>
      </Sheet>
    </>
  );
}
