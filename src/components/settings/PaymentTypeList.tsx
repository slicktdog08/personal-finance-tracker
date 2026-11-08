"use client";

import { useRef, useState, useTransition } from "react";
import { SettingTile } from "./SettingTile";
import { useDragReorder } from "./useDragReorder";
import { AddItemRow } from "./AddItemRow";
import { Button, Card } from "@/components/ds";
import {
  reorderPaymentTypes,
  updatePaymentTypeColor,
  updatePaymentTypeEmoji,
  addPaymentType,
} from "@/server/actions/config";

interface PaymentRow {
  id: number;
  name: string;
  color: string;
  emoji: string | null;
}

export function PaymentTypeList({ payments }: { payments: PaymentRow[] }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
    });

  const { order, activeId, tileProps, handleProps, move } = useDragReorder(payments, (ids) =>
    run(() => reorderPaymentTypes(ids)),
  );

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#8b5cf6");
  const [newEmoji, setNewEmoji] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const n = newName.trim();
    if (!n) return;
    run(async () => {
      await addPaymentType(n, newColor, newEmoji);
      setNewName("");
      setNewEmoji(null);
    });
  };

  return (
    <Card
      title="Payment types"
      action={
        <Button size="sm" icon="plus" onClick={() => addRef.current?.focus()}>
          Add
        </Button>
      }
    >
      {order.map((p, i) => (
        <SettingTile
          key={p.id}
          name={p.name}
          color={p.color}
          emoji={p.emoji}
          icon="credit-card"
          disabled={pending}
          dragging={activeId === p.id}
          tileProps={tileProps(p.id)}
          handleProps={handleProps(p.id)}
          onMoveUp={i > 0 ? () => move(p.id, -1) : null}
          onMoveDown={i < order.length - 1 ? () => move(p.id, 1) : null}
          onColor={(c) => run(() => updatePaymentTypeColor(p.id, c))}
          onEmoji={(e) => run(() => updatePaymentTypeEmoji(p.id, e))}
        />
      ))}

      <AddItemRow
        inputRef={addRef}
        noun="payment type"
        name={newName}
        onName={setNewName}
        color={newColor}
        onColor={setNewColor}
        emoji={newEmoji}
        onEmoji={setNewEmoji}
        onAdd={add}
        pending={pending}
      />
    </Card>
  );
}
