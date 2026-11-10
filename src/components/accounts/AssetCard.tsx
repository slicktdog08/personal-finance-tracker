"use client";

import { useState, useTransition } from "react";
import { ASSET_KINDS, ASSET_KIND_META, type AssetKind } from "@/constants/enums";
import { formatMoney, toNum } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import { addAssetValue, deleteAsset, deleteAssetValue, updateAsset } from "@/server/actions/assets";
import { Button, Field, Glyph, Icon, IconButton, Input, Money, Select, cx } from "@/components/ds";

export interface AssetInfo {
  id: number;
  name: string;
  kind: string;
  purchasePrice: string | null;
  acquiredOn: string | null;
  notes: string | null;
  values: { id: number; value: string; asOf: string; note: string | null }[];
}

const KIND_OPTIONS = ASSET_KINDS.map((k) => ({ value: k, label: ASSET_KIND_META[k].label }));
const ASSET_COLOR = "#d97706";
const num = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() === "" || Number.isNaN(n) ? null : n;
};

/** One asset as a list row; expanded it edits the asset and its value history. */
export function AssetCard({ asset }: { asset: AssetInfo }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const latest = asset.values[0];
  const cur = toNum(latest?.value ?? null);
  const purchase = toNum(asset.purchasePrice);
  // Change since the first recorded value — how much it has depreciated (or appreciated).
  const first = asset.values[asset.values.length - 1];
  const change = cur != null && first && first !== latest ? cur - (toNum(first.value) ?? cur) : null;
  const meta = ASSET_KIND_META[(asset.kind as AssetKind) ?? "other"] ?? ASSET_KIND_META.other;
  const id = `asset-${asset.id}`;

  const save = (patch: Parameters<typeof updateAsset>[1]) => start(() => updateAsset(asset.id, patch));
  const record = () => {
    const n = num(value);
    if (n == null || !asOf) return;
    start(async () => {
      await addAssetValue(asset.id, n, asOf, note || null);
      setValue("");
      setNote("");
    });
  };

  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="mp-listrow mp-listrow--button !border-b-0"
      >
        <Glyph icon={meta.icon} color={ASSET_COLOR} />
        <span className="mp-listrow__main">
          <span className="mp-listrow__title">{asset.name}</span>
          <span className="mp-listrow__sub truncate">
            {meta.label}
          </span>
        </span>
        <span className="mp-listrow__end">
          {cur != null ? <Money value={cur} kind="neutral" /> : <span className="text-fg-3">—</span>}
          <span className="mp-listrow__sub">{latest ? `as of ${formatDate(latest.asOf)}` : "no value yet"}</span>
        </span>
        <Icon name="chevron-down" size={16} className={cx("shrink-0 text-fg-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div id={id} className="mb-3 space-y-4 rounded-panel bg-sunken p-3.5">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_minmax(0,9rem)_minmax(0,10rem)]">
            <Field label="Name" htmlFor={`${id}-name`}>
              <Input
                id={`${id}-name`}
                defaultValue={asset.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== asset.name && save({ name: e.target.value })}
              />
            </Field>
            <Field label="Kind" htmlFor={`${id}-kind`}>
              <Select id={`${id}-kind`} value={asset.kind} onChange={(e) => save({ kind: e.target.value })} options={KIND_OPTIONS} />
            </Field>
            <Field label="Paid" htmlFor={`${id}-paid`}>
              <Input
                id={`${id}-paid`}
                money
                defaultValue={asset.purchasePrice ?? ""}
                placeholder="Optional"
                onBlur={(e) => (asset.purchasePrice ?? "") !== e.target.value.trim() && save({ purchasePrice: num(e.target.value) })}
              />
            </Field>
            <Field label="Acquired" htmlFor={`${id}-acq`}>
              <Input
                id={`${id}-acq`}
                type="date"
                defaultValue={asset.acquiredOn ?? ""}
                onBlur={(e) => (asset.acquiredOn ?? "") !== e.target.value && save({ acquiredOn: e.target.value || null })}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="text-sm font-medium">
              Worth
              <span className="ml-2 text-xs font-normal text-fg-3">counts toward net worth, not cash on hand</span>
            </div>
            <div className="text-right">
              <span className="text-lg font-semibold">{cur != null ? <Money value={cur} kind="neutral" /> : "—"}</span>
              <div className="mt-0.5 flex flex-wrap justify-end gap-x-3 text-xs text-fg-3">
                {change != null && Math.round(change) !== 0 && (
                  <span>
                    {change > 0 ? "+" : "−"}
                    {formatMoney(Math.abs(change))} since {formatDate(first.asOf)}
                  </span>
                )}
                {purchase != null && <span>paid {formatMoney(purchase)}</span>}
              </div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[minmax(0,9rem)_minmax(0,10rem)_minmax(0,1fr)_auto] sm:items-end">
            <Field label="Value" htmlFor={`${id}-val`}>
              <Input id={`${id}-val`} money value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="As of" htmlFor={`${id}-asof`}>
              <Input id={`${id}-asof`} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </Field>
            <Field label="Note" htmlFor={`${id}-note`}>
              <Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. KBB private party" />
            </Field>
            <Button onClick={record} disabled={pending || num(value) == null} icon="plus">
              Record value
            </Button>
          </div>

          {asset.values.length > 0 && (
            <details className="group">
              <summary className="flex cursor-pointer select-none items-center gap-1 text-xs text-fg-3 hover:text-fg">
                <Icon name="chevron-right" size={14} className="transition-transform group-open:rotate-90" />
                History ({asset.values.length} recorded)
              </summary>
              <div className="mt-2 max-h-48 overflow-x-auto overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {asset.values.map((v) => (
                      <tr key={v.id} className="border-t border-line">
                        <td className="py-1.5 tabular-nums">{formatDate(v.asOf)}</td>
                        <td className="py-1.5 text-right font-medium">
                          <Money value={v.value} kind="neutral" />
                        </td>
                        <td className="max-w-48 truncate py-1.5 pl-3 text-fg-3">{v.note ?? ""}</td>
                        <td className="py-1 text-right">
                          <IconButton icon="trash-2" size="sm" label="Delete this value" onClick={() => start(() => deleteAssetValue(v.id))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <p className="text-xs text-fg-3">Sold it? Record a $0 value on the sale date — past months keep what it was worth.</p>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-fg-3">Delete it and its whole history?</span>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
                <Button size="sm" variant="danger" loading={pending} onClick={() => start(() => deleteAsset(asset.id))}>
                  Delete
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" icon="trash-2" onClick={() => setConfirmDelete(true)}>
                Delete asset
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
