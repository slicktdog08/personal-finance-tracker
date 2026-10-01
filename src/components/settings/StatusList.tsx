"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SettingTile } from "./SettingTile";
import { useDragReorder } from "./useDragReorder";
import { EmojiPicker } from "@/components/EmojiPicker";
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
  const router = useRouter();
  const [pending, start] = useTransition();
  const refresh = () => router.refresh();
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      refresh();
    });

  const { order, activeId, tileProps, handleProps, move } = useDragReorder(statuses, (ids) =>
    run(() => reorderStatuses(ids)),
  );

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [newEmoji, setNewEmoji] = useState<string | null>(null);
  const [newSettled, setNewSettled] = useState(false);

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

  const inputCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";

  return (
    <div className="space-y-2">
      {order.map((s, i) => (
        <SettingTile
          key={s.id}
          name={s.name}
          color={s.color}
          emoji={s.emoji}
          disabled={pending}
          dragging={activeId === s.id}
          tileProps={tileProps(s.id)}
          handleProps={handleProps(s.id)}
          onMoveUp={i > 0 ? () => move(s.id, -1) : null}
          onMoveDown={i < order.length - 1 ? () => move(s.id, 1) : null}
          onColor={(c) => run(() => updateStatusColor(s.id, c))}
          onEmoji={(e) => run(() => updateStatusEmoji(s.id, e))}
          badge={
            s.isSettled ? (
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-black/15">
                settled
              </span>
            ) : null
          }
          editorExtras={
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={s.isSettled}
                disabled={pending}
                onChange={(e) => run(() => updateStatusSettled(s.id, e.target.checked))}
              />
              <span className="text-neutral-500">Counts as settled (paid-off rollups)</span>
            </label>
          }
        />
      ))}

      {/* Add new status */}
      <div className="flex flex-wrap items-center gap-2 pt-3 mt-1 border-t border-neutral-200 dark:border-neutral-800">
        <input
          type="color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          aria-label="New status color"
          className="w-9 h-9 rounded border-0 bg-transparent"
        />
        <EmojiPicker value={newEmoji} onSelect={setNewEmoji} title="Pick an emoji for the new status" />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="new status name"
          className={inputCls + " flex-1 min-w-40"}
        />
        <label className="text-xs text-neutral-500 flex items-center gap-1">
          <input
            type="checkbox"
            checked={newSettled}
            onChange={(e) => setNewSettled(e.target.checked)}
          />
          settled
        </label>
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
