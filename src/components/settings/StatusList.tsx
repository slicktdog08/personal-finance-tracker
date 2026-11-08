"use client";

import { useRef, useState, useTransition } from "react";
import { SettingTile } from "./SettingTile";
import { useDragReorder } from "./useDragReorder";
import { AddItemRow } from "./AddItemRow";
import { Button, Card, Checkbox, Switch } from "@/components/ds";
import {
  reorderStatuses,
  updateStatusColor,
  updateStatusEmoji,
  updateStatusSettled,
  addStatus,
} from "@/server/actions/config";

interface StatusRow {
  id: number;
  name: string;
  color: string;
  emoji: string | null;
  isSettled: boolean;
}

export function StatusList({ statuses }: { statuses: StatusRow[] }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
    });

  const { order, activeId, tileProps, handleProps, move } = useDragReorder(statuses, (ids) =>
    run(() => reorderStatuses(ids)),
  );

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [newEmoji, setNewEmoji] = useState<string | null>(null);
  const [newSettled, setNewSettled] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const n = newName.trim();
    if (!n) return;
    run(async () => {
      await addStatus(n, newColor, newSettled, newEmoji);
      setNewName("");
      setNewEmoji(null);
      setNewSettled(false);
    });
  };

  return (
    <Card
      title="Bill statuses"
      meta="settled ones count as paid"
      action={
        <Button size="sm" icon="plus" onClick={() => addRef.current?.focus()}>
          Add
        </Button>
      }
    >
      {order.map((s, i) => (
        <SettingTile
          key={s.id}
          name={s.name}
          color={s.color}
          emoji={s.emoji}
          icon="circle-dot"
          disabled={pending}
          dragging={activeId === s.id}
          tileProps={tileProps(s.id)}
          handleProps={handleProps(s.id)}
          onMoveUp={i > 0 ? () => move(s.id, -1) : null}
          onMoveDown={i < order.length - 1 ? () => move(s.id, 1) : null}
          onColor={(c) => run(() => updateStatusColor(s.id, c))}
          onEmoji={(e) => run(() => updateStatusEmoji(s.id, e))}
          // The settled flag sits on the row face (kit), not behind the edit toggle.
          headerActions={
            <Switch
              label={<span className="text-sm text-fg-2">Counts as settled</span>}
              checked={s.isSettled}
              disabled={pending}
              title="Settled statuses count toward the paid-off rollups"
              onChange={(e) => run(() => updateStatusSettled(s.id, e.target.checked))}
              className="shrink-0"
            />
          }
        />
      ))}

      <AddItemRow
        inputRef={addRef}
        noun="status"
        name={newName}
        onName={setNewName}
        color={newColor}
        onColor={setNewColor}
        emoji={newEmoji}
        onEmoji={setNewEmoji}
        onAdd={add}
        pending={pending}
        extra={<Checkbox label="Settled" checked={newSettled} onChange={(e) => setNewSettled(e.target.checked)} />}
      />
    </Card>
  );
}
