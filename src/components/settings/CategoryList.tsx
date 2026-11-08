"use client";

import { useRef, useState, useTransition } from "react";
import { SettingTile } from "./SettingTile";
import { AddItemRow } from "./AddItemRow";
import { useDragReorder } from "./useDragReorder";
import { Badge, Button, Card, IconButton, Input, Select } from "@/components/ds";
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
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
    });

  const { order, activeId, tileProps, handleProps, move } = useDragReorder(categories, (ids) =>
    run(() => reorderCategories(ids)),
  );

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");
  const [newEmoji, setNewEmoji] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [reassignTo, setReassignTo] = useState<string>("");

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
    });
  }

  return (
    <Card
      title="Categories"
      meta="colors show on every badge"
      action={
        <Button size="sm" icon="plus" onClick={() => addRef.current?.focus()}>
          Add
        </Button>
      }
    >
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
            icon="tag"
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
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !renameInvalid) saveRename(c.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  aria-label={`Rename ${c.name}`}
                  className="!h-8 w-44 max-w-full"
                  autoFocus
                />
              ) : undefined
            }
            badge={
              <>
                {!c.active && <Badge label="Disabled" variant="outline" dot={false} size="sm" />}
                <span className="shrink-0 text-xs tabular-nums text-fg-3">
                  {c.count} txn{c.count === 1 ? "" : "s"}
                </span>
              </>
            }
            headerActions={
              isEditing ? (
                <span className="flex shrink-0 items-center gap-1">
                  <Button size="sm" onClick={() => saveRename(c.id)} disabled={pending || renameInvalid}>
                    Save name
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={pending}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <span className="flex shrink-0 items-center">
                  <IconButton
                    icon="pencil-line"
                    size="sm"
                    label={`Rename ${c.name}`}
                    onClick={() => {
                      setEditingId(c.id);
                      setEditName(c.name);
                    }}
                    disabled={pending}
                  />
                  <IconButton
                    icon={c.active ? "eye-off" : "eye"}
                    size="sm"
                    label={
                      c.active
                        ? `Disable ${c.name}: hide it from category pickers for new transactions (existing ones keep it)`
                        : `Enable ${c.name}: show it in category pickers again`
                    }
                    onClick={() => run(() => setCategoryActive(c.id, !c.active))}
                    disabled={pending}
                  />
                  <IconButton
                    icon="trash-2"
                    size="sm"
                    label={`Delete ${c.name}`}
                    onClick={() => {
                      setDeletingId(deletingId === c.id ? null : c.id);
                      setReassignTo(others[0]?.name ?? "");
                    }}
                    disabled={pending}
                  />
                </span>
              )
            }
            belowSlot={
              deletingId === c.id ? (
                <div className="mb-2.5 flex flex-wrap items-center gap-2 rounded-panel bg-warn-soft px-3 py-2.5 text-sm text-fg">
                  {c.count > 0 ? (
                    others.length > 0 ? (
                      <>
                        <span>
                          {c.count} transaction{c.count === 1 ? " is" : "s are"} in this category. Move {c.count === 1 ? "it" : "them"} to:
                        </span>
                        <Select
                          value={reassignTo}
                          onChange={(e) => setReassignTo(e.target.value)}
                          disabled={pending}
                          aria-label="Reassign transactions to category"
                          className="!h-8 w-auto max-w-full"
                          options={others.map((o) => ({ value: o.name, label: `${o.emoji ? `${o.emoji} ` : ""}${o.name}` }))}
                        />
                        <Button size="sm" variant="danger" onClick={() => confirmDelete(c.id)} disabled={pending || !reassignTo}>
                          Delete and reassign
                        </Button>
                      </>
                    ) : (
                      <span>
                        {c.count} transaction{c.count === 1 ? " is" : "s are"} in this category and there is no other category to
                        move them to. Add one first, or disable this category instead.
                      </span>
                    )
                  ) : (
                    <>
                      <span>No transactions use this category.</span>
                      <Button size="sm" variant="danger" onClick={() => confirmDelete(c.id)} disabled={pending}>
                        Delete category
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setDeletingId(null)} disabled={pending}>
                    Cancel
                  </Button>
                </div>
              ) : null
            }
          />
        );
      })}
      {order.length === 0 && <p className="py-3 text-sm text-fg-3">No categories yet.</p>}

      <AddItemRow
        inputRef={addRef}
        noun="category"
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
