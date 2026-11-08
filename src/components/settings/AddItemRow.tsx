"use client";

import { EmojiPicker } from "@/components/EmojiPicker";
import { Button, type VarStyle } from "@/components/ds";

/**
 * The "add one" row at the foot of each settings list card: color, emoji, name, Add. The card's
 * header "Add" button focuses `inputRef`, so the two stay one flow.
 */
export function AddItemRow({
  inputRef,
  noun,
  name,
  onName,
  color,
  onColor,
  emoji,
  onEmoji,
  onAdd,
  pending,
  extra,
}: {
  inputRef?: React.RefObject<HTMLInputElement | null>;
  noun: string;
  name: string;
  onName: (v: string) => void;
  color: string;
  onColor: (v: string) => void;
  emoji: string | null;
  onEmoji: (v: string | null) => void;
  onAdd: () => void;
  pending: boolean;
  /** Per-list extra inputs (e.g. the settled flag for a new status). */
  extra?: React.ReactNode;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-panel bg-sunken p-2.5">
      <label
        title={`New ${noun} color`}
        className="relative h-8 w-8 shrink-0 cursor-pointer rounded-full"
        style={{ background: color } as VarStyle}
      >
        <input
          type="color"
          value={color}
          onChange={(e) => onColor(e.target.value)}
          aria-label={`New ${noun} color`}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <EmojiPicker value={emoji} onSelect={onEmoji} title={`Pick an emoji for the new ${noun}`} />
      {/* Plain input (not ds Input) so the header's Add button can hold a ref to it. */}
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => onName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onAdd()}
        placeholder={`New ${noun} name`}
        aria-label={`New ${noun} name`}
        className="mp-input min-w-0 flex-1 basis-40"
      />
      {extra}
      <Button size="sm" icon="plus" onClick={onAdd} disabled={pending || !name.trim()}>
        Add {noun}
      </Button>
    </div>
  );
}
