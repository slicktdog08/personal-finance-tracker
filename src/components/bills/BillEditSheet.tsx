"use client";

import { memo, useImperativeHandle, useState, useTransition, type Ref } from "react";
import Link from "next/link";
import { parseMoney, toNum } from "@/server/lib/money";
import { ColorSelect } from "@/components/ColorSelect";
import { Badge, Button, Field, Glyph, Icon, Input, Money, Notice, Sheet, Switch, buttonClass } from "@/components/ds";
import type { InstancePatch } from "@/server/lib/bill-types";
import { applyDueDayForward } from "@/server/actions/bills";
import { billIcon } from "./billGlyph";
import type { BillFacts, ColorItem, SheetRow, StatusItem } from "./billFacts";

export interface BillEditHandle {
  open: (id: number) => void;
}

/**
 * The edit sheet for one bill of the month. It owns its own open/closed state and is opened
 * through the handle, so opening and closing it re-renders this component alone — the table
 * behind it is never asked to render for a dialog it doesn't show.
 */
export const BillEditSheet = memo(function BillEditSheet({
  ref,
  path,
  rows,
  statuses,
  payments,
  facts,
  pending: saving,
  onSave,
  onDelete,
  onStatusColor,
  onPaymentColor,
}: {
  ref: Ref<BillEditHandle>;
  path: string;
  /** The month's bills, optimistic edits included, so the sheet shows a change the moment it's made. */
  rows: SheetRow[];
  statuses: StatusItem[];
  payments: ColorItem[];
  facts: BillFacts;
  pending: boolean;
  onSave: (id: number, patch: InstancePatch) => void;
  onDelete: (id: number) => void;
  onStatusColor: (id: number, color: string) => void;
  onPaymentColor: (id: number, color: string) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [applying, start] = useTransition();
  const pending = saving || applying;
  useImperativeHandle(ref, () => ({ open: (id: number) => setEditing(id) }), []);
  const close = () => setEditing(null);

  // A deleted bill has no row any more, which closes the sheet.
  const editRow = editing != null ? (rows.find((r) => r.id === editing) ?? null) : null;
  // Latch the last-open row so the Sheet keeps its content while the exit animation plays.
  const [shownRow, setShownRow] = useState(editRow);
  if (editRow && editRow !== shownRow) {
    if (shownRow?.id !== editRow.id) setFlash(null);
    setShownRow(editRow);
  }
  if (!shownRow) return null;

  const { mon, paidStatus } = facts;
  const row = shownRow;
  const save = (patch: InstancePatch) => onSave(row.id, patch);

  return (
    <Sheet open={editRow != null} onClose={close} title={row.name}>
      <div key={row.id} className="grid gap-4 text-left">
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
          <Glyph icon={billIcon(row.name, row.isDebt)} color={facts.statusInfo.get(row.status)?.color} />
          <Money value={row.amount} kind={facts.isPastDue(row) ? "over" : "neutral"} className="font-semibold text-fg" />
          <span>·</span>
          <span>{row.dueDay != null ? `Due ${mon} ${row.dueDay}` : "No due day"}</span>
          {row.isDebt && <Badge label="Debt" variant="outline" size="sm" dot={false} />}
          {row.isCancel && <Badge label="Cancel" variant="outline" size="sm" color="#e11d48" icon="scissors" title="Marked to cancel" />}
        </div>
        <Field label="Name" htmlFor="bill-edit-name">
          <Input
            id="bill-edit-name"
            defaultValue={row.name}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== row.name) save({ name: v });
            }}
          />
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
          <Field label="Amount" htmlFor="bill-edit-amount">
            <Input
              id="bill-edit-amount"
              money
              defaultValue={row.amount ?? ""}
              onBlur={(e) => {
                const v = parseMoney(e.target.value);
                if (v !== toNum(row.amount)) save({ amount: v });
              }}
            />
          </Field>
          <Field label="Due day" htmlFor="bill-edit-due">
            <Input
              id="bill-edit-due"
              type="number"
              min={1}
              max={31}
              inputMode="numeric"
              defaultValue={row.dueDay ?? ""}
              onBlur={(e) => {
                const v = e.target.value === "" ? null : Number(e.target.value);
                if (v !== row.dueDay) save({ dueDay: v });
              }}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <div>
              <ColorSelect value={row.status} options={statuses} onSelect={(name) => save({ status: name })} onColorChange={onStatusColor} />
            </div>
          </Field>
          <Field label="Payment">
            <div>
              <ColorSelect
                value={row.paymentType ?? ""}
                options={payments}
                allowEmpty
                placeholder="None"
                onSelect={(name) => save({ paymentType: name || null })}
                onColorChange={onPaymentColor}
              />
            </div>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Switch label="Debt payment" defaultChecked={row.isDebt} onChange={(e) => save({ isDebt: e.target.checked })} />
          <Switch label="Marked to cancel" defaultChecked={row.isCancel} onChange={(e) => save({ isCancel: e.target.checked })} />
        </div>
        {flash && <Notice tone="ok">{flash}</Notice>}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button
            size="sm"
            variant="ghost"
            icon="calendar-clock"
            title="Apply this due day to all later months"
            disabled={row.dueDay == null || pending}
            onClick={() =>
              start(async () => {
                const n = await applyDueDayForward(row.id, path);
                setFlash(`Due day applied to ${n} later month${n === 1 ? "" : "s"}.`);
              })
            }
          >
            Apply due day forward
          </Button>
          {row.billId ? (
            <Link href={`/settings/bills/${row.billId}`} className={buttonClass({ variant: "ghost", size: "sm" })}>
              <Icon name="history" size={15} />
              Bill history
            </Link>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            icon="trash-2"
            className="text-over"
            onClick={() => {
              if (confirm(`Delete "${row.name}"?`)) {
                close();
                onDelete(row.id);
              }
            }}
          >
            Delete
          </Button>
          <span className="flex-1" />
          {pending && <span className="text-xs text-fg-3">Saving…</span>}
          {!facts.isSettled(row) && paidStatus && (
            <Button
              size="sm"
              icon="check"
              onClick={() => {
                save({ status: paidStatus });
                close();
              }}
            >
              Mark paid
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
});
