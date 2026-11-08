"use client";

import { useState } from "react";
import { toHexInput } from "@/lib/colors";
import { EmojiPicker } from "@/components/EmojiPicker";
import { Badge, Glyph, Icon, IconButton, cx, type IconName, type VarStyle } from "@/components/ds";

// The kit's quick-pick palette. Any other hex is still one tap away via the custom swatch.
export const SWATCHES = ["#22c55e", "#0ea5e9", "#6366f1", "#a855f7", "#d946ef", "#ef4444", "#f97316", "#eab308", "#64748b"];

/**
 * One reorderable row in a settings list (category, bill status, payment type), in the kit's
 * shape: glyph, the item as its own solid badge, and a row of color swatches that recolor it in
 * place. Reorder is HTML5 drag on the handle (desktop) plus ▲▼ buttons — the only path that
 * works on touch. The pencil opens the emoji picker and any per-list extras; rename, delete,
 * counts and toggles come in through the slots.
 */
export function SettingTile({
  name,
  color,
  emoji,
  icon = "tag",
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
  /** Shown in the glyph when no emoji is picked. */
  icon?: IconName;
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
  // Live color preview; re-synced to the persisted color when a refresh brings a new one
  // (adjusted during render — the project pattern instead of a syncing effect).
  const [c, setC] = useState(toHexInput(color));
  const [seen, setSeen] = useState(color);
  if (seen !== color) {
    setSeen(color);
    setC(toHexInput(color));
  }
  const custom = !SWATCHES.includes(c.toLowerCase());

  const pick = (hex: string) => {
    if (disabled || hex === toHexInput(color)) return;
    setC(hex);
    onColor(hex);
  };

  return (
    <div {...tileProps} className={cx("border-b border-line last:border-b-0", dragging && "rounded-panel bg-accent-soft opacity-70")}>
      <div className={cx("flex flex-wrap items-center gap-x-2.5 gap-y-2 py-2.5", muted && "opacity-55 saturate-50")}>
        <span
          {...handleProps}
          title="Drag to reorder"
          aria-label="Drag to reorder"
          className="hidden shrink-0 cursor-grab touch-none text-fg-3 hover:text-fg active:cursor-grabbing md:inline-flex"
        >
          <Icon name="grip-vertical" size={16} />
        </span>
        {(onMoveUp !== undefined || onMoveDown !== undefined) && (
          <span className="flex shrink-0">
            <IconButton icon="chevron-up" size="sm" label={`Move ${name} up`} onClick={onMoveUp ?? undefined} disabled={!onMoveUp || disabled} />
            <IconButton icon="chevron-down" size="sm" label={`Move ${name} down`} onClick={onMoveDown ?? undefined} disabled={!onMoveDown || disabled} />
          </span>
        )}
        <Glyph icon={emoji ? undefined : icon} color={c} size="sm">
          {emoji ? <span className="text-sm leading-none">{emoji}</span> : null}
        </Glyph>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {nameSlot ?? <Badge label={name} color={c} variant="solid" dot={false} className="max-w-full" />}
          {badge}
        </div>
        {/* Swatches drop to their own line on phones; inline from lg. */}
        <div className="order-last flex basis-full flex-wrap items-center gap-1 lg:order-none lg:basis-auto" role="group" aria-label={`${name} color`}>
          {SWATCHES.map((s) => (
            <button
              key={s}
              type="button"
              aria-label={s}
              aria-pressed={c.toLowerCase() === s}
              disabled={disabled}
              onClick={() => pick(s)}
              className="h-[18px] w-[18px] shrink-0 cursor-pointer rounded-full border-0 disabled:cursor-not-allowed"
              style={{
                background: s,
                boxShadow: c.toLowerCase() === s ? `0 0 0 2px var(--mp-bg-surface), 0 0 0 4px ${s}` : "none",
              }}
            />
          ))}
          {/* Any other hex: the native picker, drawn as one more swatch. Previews live, saves on blur. */}
          <label
            title="Custom color"
            className="relative ml-0.5 grid h-[18px] w-[18px] shrink-0 cursor-pointer place-items-center rounded-full border border-dashed border-line-strong"
            style={custom ? ({ background: c, borderStyle: "solid", borderColor: c, boxShadow: `0 0 0 2px var(--mp-bg-surface), 0 0 0 4px ${c}` } as VarStyle) : undefined}
          >
            {!custom && <Icon name="plus" size={11} className="text-fg-3" />}
            <input
              type="color"
              value={c}
              disabled={disabled}
              onChange={(e) => setC(e.target.value)}
              onBlur={() => c !== toHexInput(color) && onColor(c)}
              aria-label={`${name} custom color`}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </div>
        {headerActions}
        <IconButton
          icon={editing ? "check" : "ellipsis"}
          size="sm"
          label={editing ? "Done" : `More options for ${name}`}
          onClick={() => setEditing((e) => !e)}
          disabled={disabled}
        />
      </div>

      {editing && (
        <div className="mb-2.5 flex flex-wrap items-center gap-4 rounded-panel bg-sunken px-3 py-2.5 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-fg-2">Emoji</span>
            <EmojiPicker value={emoji} onSelect={onEmoji} disabled={disabled} />
          </label>
          {editorExtras}
        </div>
      )}
      {belowSlot}
    </div>
  );
}
