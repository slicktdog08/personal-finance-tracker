"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SettingTile } from "./SettingTile";
import { useDragReorder } from "./useDragReorder";
import { EmojiPicker } from "@/components/EmojiPicker";
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
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  const { order, activeId, tileProps, handleProps, move } = useDragReorder(payments, (ids) =>
    run(() => reorderPaymentTypes(ids)),
  );

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#8b5cf6");
  const [newEmoji, setNewEmoji] = useState<string | null>(null);

  const add = () => {
    const n = newName.trim();
    if (!n) return;
    run(async () => {
      await addPaymentType(n, newColor, newEmoji);
      setNewName("");
      setNewEmoji(null);
    });
  };

  const inputCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";

  return (
    <div className="space-y-2">
      {order.map((p, i) => (
        <SettingTile
          key={p.id}
          name={p.name}
          color={p.color}
          emoji={p.emoji}
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

      {/* Add new payment type */}
      <div className="flex flex-wrap items-center gap-2 pt-3 mt-1 border-t border-neutral-200 dark:border-neutral-800">
        <input
          type="color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          aria-label="New payment type color"
          className="w-9 h-9 rounded border-0 bg-transparent"
        />
        <EmojiPicker
          value={newEmoji}
          onSelect={setNewEmoji}
          title="Pick an emoji for the new payment type"
        />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="new payment type"
          className={inputCls + " flex-1 min-w-40"}
        />
        <button
          onClick={add}
          disabled={pending || !newName.trim()}
          className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
