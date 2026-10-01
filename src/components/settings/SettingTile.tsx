"use client";

import { useEffect, useState } from "react";
import { badgeStyle, toHexInput } from "@/lib/colors";
import { EmojiPicker } from "@/components/EmojiPicker";
import { GripIcon } from "@/components/icons";

// A single reorderable list item rendered as a full-color tile. The picked color is the
// tile background (readable text auto-computed). A "Change" button reveals the color +
// emoji editors. Per-list extras (settled toggle, rename, delete, counts) come via slots.
export function SettingTile({
  name,
  color,
  emoji,
  disabled = false,
  dragging = false,
  muted = false,
  tileProps,
  handleProps,
  onMoveUp,
  onMoveDown,
  onColor,
  onEmoji,
  nameSlot,
  badge,
  headerActions,
  editorExtras,
  belowSlot,
}: {
  name: string;
  color: string;
  emoji: string | null;
  disabled?: boolean;
  dragging?: boolean;
  /** Washed-out rendering for items that exist but are switched off (e.g. disabled categories). */
  muted?: boolean;
  tileProps?: React.HTMLAttributes<HTMLDivElement>;
  handleProps?: React.HTMLAttributes<HTMLElement>;
  /** Touch-friendly reorder fallback (drag doesn't work on mobile). null = at that end. */
  onMoveUp?: (() => void) | null;
  onMoveDown?: (() => void) | null;
  onColor: (color: string) => void;
  onEmoji: (emoji: string | null) => void;
  nameSlot?: React.ReactNode;
  badge?: React.ReactNode;
  headerActions?: React.ReactNode;
  editorExtras?: React.ReactNode;
  belowSlot?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  // Live color preview; re-sync to the persisted color after a refresh.
  const [c, setC] = useState(toHexInput(color));
  useEffect(() => setC(toHexInput(color)), [color]);

  return (
    <div
      {...tileProps}
      style={badgeStyle(c)}
      className={`rounded-xl shadow-sm transition-shadow ${
        dragging ? "opacity-60 ring-2 ring-blue-400" : muted ? "opacity-55 saturate-50" : ""
      }`}
    >
      {/* Colored header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          {...handleProps}
          title="Drag to reorder"
          aria-label="Drag to reorder"
          className="cursor-grab active:cursor-grabbing opacity-70 hover:opacity-100 shrink-0 touch-none"
        >
          <GripIcon />
        </span>
        {(onMoveUp !== undefined || onMoveDown !== undefined) && (
          <span className="flex shrink-0 gap-0.5">
            <button
              type="button"
              onClick={onMoveUp ?? undefined}
              disabled={!onMoveUp || disabled}
              aria-label={`Move ${name} up`}
              className="h-9 w-8 md:h-7 md:w-7 flex items-center justify-center rounded bg-black/10 hover:bg-black/20 text-xs disabled:opacity-30"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={onMoveDown ?? undefined}
              disabled={!onMoveDown || disabled}
              aria-label={`Move ${name} down`}
              className="h-9 w-8 md:h-7 md:w-7 flex items-center justify-center rounded bg-black/10 hover:bg-black/20 text-xs disabled:opacity-30"
            >
              ▼
            </button>
          </span>
        )}
        <span className="text-2xl leading-none w-8 text-center shrink-0">
          {emoji || <span className="opacity-40 text-base">·</span>}
        </span>
        <div className="min-w-0 flex-1">{nameSlot ?? <span className="font-medium truncate">{name}</span>}</div>
        {badge}
        {headerActions}
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          disabled={disabled}
          className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-md bg-black/15 hover:bg-black/25 disabled:opacity-50"
        >
          {editing ? "Done" : "Change"}
        </button>
      </div>

      {/* Neutral editor panel (kept readable regardless of tile color) */}
      {editing && (
        <div className="rounded-b-xl bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 border-t border-black/10 px-3 py-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-neutral-500">Color</span>
            <input
              type="color"
              value={c}
              disabled={disabled}
              onChange={(e) => setC(e.target.value)}
              onBlur={() => c !== toHexInput(color) && onColor(c)}
              aria-label={`${name} color`}
              className="w-9 h-9 p-0 rounded border-0 bg-transparent cursor-pointer disabled:opacity-50"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-neutral-500">Emoji</span>
            <EmojiPicker value={emoji} onSelect={onEmoji} disabled={disabled} />
          </label>
          {editorExtras}
        </div>
      )}
      {belowSlot}
    </div>
  );
}
