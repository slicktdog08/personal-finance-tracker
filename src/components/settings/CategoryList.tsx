"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SettingTile } from "./SettingTile";
import { useDragReorder } from "./useDragReorder";
import { EmojiPicker } from "@/components/EmojiPicker";
import { PencilIcon } from "@/components/icons";
import {
  reorderCategories,
  updateCategoryColor,
  updateCategoryEmoji,
  renameCategory,
  deleteCategory,
  addCategory,
  setCategoryActive,
} from "@/server/actions/config";

export interface CategoryItem {
  id: number;
  name: string;
  color: string;
  emoji: string | null;
  count: number;
  active: boolean;
}

export function CategoryList({ categories }: { categories: CategoryItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const refresh = () => router.refresh();
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      refresh();
    });

  const { order, activeId, tileProps, handleProps, move } = useDragReorder(categories, (ids) =>
    run(() => reorderCategories(ids)),
  );

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");
  const [newEmoji, setNewEmoji] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [reassignTo, setReassignTo] = useState<string>("");

  const inputCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";

  function add() {
    const n = newName.trim();
    if (!n) return;
    start(async () => {
      const res = await addCategory(n, newColor, newEmoji);
      if (!res.ok) {
        alert(res.error ?? "Could not add category");
        return;
      }
      setNewName("");
      setNewEmoji(null);
      refresh();
    });
  }

  function saveRename(id: number) {
    start(async () => {
      const res = await renameCategory(id, editName);
      if (!res.ok) {
        alert(res.error ?? "Rename failed");
        return;
      }
      setEditingId(null);
      refresh();
    });
  }

  function confirmDelete(id: number) {
    start(async () => {
      const res = await deleteCategory(id, reassignTo || null);
      if (!res.ok) {
        alert(res.error ?? "Delete failed");
        return;
      }
      setDeletingId(null);
      setReassignTo("");
      refresh();
    });
  }

  return (
    <div className="space-y-2">
      {order.map((c, i) => {
        const others = order.filter((o) => o.id !== c.id);
        const renameInvalid = !editName.trim() || editName.trim() === c.name;
        const isEditing = editingId === c.id;
        return (
          <SettingTile
            key={c.id}
            name={c.name}
            color={c.color}
            emoji={c.emoji}
            disabled={pending}
            dragging={activeId === c.id}
            muted={!c.active}
            tileProps={tileProps(c.id)}
            handleProps={handleProps(c.id)}
            onMoveUp={i > 0 ? () => move(c.id, -1) : null}
            onMoveDown={i < order.length - 1 ? () => move(c.id, 1) : null}
            onColor={(col) => run(() => updateCategoryColor(c.id, col))}
            onEmoji={(e) => run(() => updateCategoryEmoji(c.id, e))}
            nameSlot={
              isEditing ? (
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !renameInvalid) saveRename(c.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  aria-label={`Rename ${c.name}`}
                  className="bg-white/90 text-neutral-900 rounded px-1.5 py-0.5 text-sm w-44"
                  autoFocus
                />
              ) : (
                <span className="font-medium truncate">{c.name}</span>
              )
            }
            badge={
              <>
                {!c.active && (
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-black/25">
                    disabled
                  </span>
                )}
                <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-black/15">
                  {c.count} txns
                </span>
              </>
            }
            headerActions={
              isEditing ? (
                <>
                  <button
                    onClick={() => saveRename(c.id)}
                    disabled={pending || renameInvalid}
                    className="shrink-0 text-xs font-medium px-2 py-1 rounded-md bg-black/15 hover:bg-black/25 disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    disabled={pending}
                    className="shrink-0 text-xs px-1.5 py-1 rounded hover:bg-black/15 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setEditingId(c.id);
                      setEditName(c.name);
                    }}
                    disabled={pending}
                    title="Rename"
                    aria-label={`Rename ${c.name}`}
                    className="shrink-0 p-1 rounded hover:bg-black/15 disabled:opacity-50"
                  >
                    <PencilIcon />
                  </button>
                  <button
                    onClick={() => run(() => setCategoryActive(c.id, !c.active))}
                    disabled={pending}
                    title={
                      c.active
                        ? "Hide from category pickers for new transactions (existing ones keep it)"
                        : "Show in category pickers again"
                    }
                    className="shrink-0 text-xs font-medium px-2 py-1 rounded-md bg-black/15 hover:bg-black/25 disabled:opacity-50"
                  >
                    {c.active ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => {
                      setDeletingId(deletingId === c.id ? null : c.id);
                      setReassignTo(others[0]?.name ?? "");
                    }}
                    disabled={pending}
                    title="Delete"
                    className="shrink-0 text-xs font-medium px-2 py-1 rounded-md bg-black/15 hover:bg-red-600/80 hover:text-white disabled:opacity-50"
                  >
                    Delete
                  </button>
                </>
              )
            }
            belowSlot={
              deletingId === c.id ? (
                <div className="rounded-b-xl bg-amber-50 dark:bg-amber-950/40 text-neutral-900 dark:text-neutral-100 border-t border-amber-200 dark:border-amber-900 px-3 py-2.5 flex flex-wrap items-center gap-2">
                  {c.count > 0 ? (
                    others.length > 0 ? (
                      <>
                        <span className="text-sm">
                          {c.count} transaction{c.count === 1 ? " is" : "s are"} mapped to this
                          category — reassign to:
                        </span>
                        <select
                          value={reassignTo}
                          onChange={(e) => setReassignTo(e.target.value)}
                          disabled={pending}
                          aria-label="Reassign transactions to category"
                          className={inputCls}
                        >
                          {others.map((o) => (
                            <option key={o.id} value={o.name}>
                              {o.emoji ? `${o.emoji} ` : ""}
                              {o.name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => confirmDelete(c.id)}
                          disabled={pending || !reassignTo}
                          className="text-xs px-3 py-1 rounded bg-red-600 text-white font-medium disabled:opacity-50"
                        >
                          Delete &amp; reassign
                        </button>
                      </>
                    ) : (
                      <span className="text-sm">
                        {c.count} transaction{c.count === 1 ? " is" : "s are"} mapped to this
                        category and there is no other category to move them to. Add one first —
                        or just disable this category instead.
                      </span>
                    )
                  ) : (
                    <>
                      <span className="text-sm">No transactions use this category.</span>
                      <button
                        onClick={() => confirmDelete(c.id)}
                        disabled={pending}
                        className="text-xs px-3 py-1 rounded bg-red-600 text-white font-medium disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setDeletingId(null)}
                    disabled={pending}
                    className="text-xs text-neutral-500 hover:underline disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              ) : null
            }
          />
        );
      })}
      {order.length === 0 && <p className="text-sm text-neutral-500">No categories yet.</p>}

      {/* Add new category */}
      <div className="flex flex-wrap items-center gap-2 pt-3 mt-1 border-t border-neutral-200 dark:border-neutral-800">
        <input
          type="color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          aria-label="New category color"
          className="w-9 h-9 rounded border-0 bg-transparent"
        />
        <EmojiPicker
          value={newEmoji}
          onSelect={setNewEmoji}
          title="Pick an emoji for the new category"
        />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="new category name"
          aria-label="New category name"
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
