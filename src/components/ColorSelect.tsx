"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { usePopoverPosition } from "@/components/ui/usePopoverPosition";
import { toHexInput } from "@/lib/colors";
import { Icon } from "@/components/ds/Icon";
import type { VarStyle } from "@/components/ds/core";

export interface ColorOption {
  id?: number;
  name: string;
  color: string;
  emoji?: string | null;
}

// The trigger is capped at max-w-44 (176px), so the menu is always this wide.
const MENU_W = 210;
const MENU_MAX_H = 288;

export function ColorSelect({
  value,
  options,
  onSelect,
  onColorChange,
  allowEmpty = false,
  placeholder = "—",
  disabled = false,
}: {
  value: string;
  options: ColorOption[];
  onSelect: (name: string) => void;
  onColorChange?: (id: number, color: string) => void;
  allowEmpty?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Rough panel height so the hook can flip the menu above the trigger when it
  // sits low in the viewport (rows are taller when they carry a color swatch).
  const rowH = 46; // 40px color tile + 6px gap
  const estHeight = Math.min(MENU_MAX_H, (options.length + (allowEmpty ? 1 : 0)) * rowH + 8);
  const pos = usePopoverPosition(btnRef, { width: MENU_W, estHeight, open });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.name === value);

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            data-popover-root=""
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: MENU_W,
              maxHeight: Math.min(MENU_MAX_H, pos.maxHeight),
            }}
            role="listbox"
            className="z-[60] flex flex-col gap-1.5 overflow-auto rounded-panel border border-line bg-raised shadow-overlay p-1.5 motion-safe:animate-[mp-dialog-in_.2s_cubic-bezier(0.16,1,0.3,1)]"
          >
            {allowEmpty && (
              <button
                type="button"
                role="option"
                aria-selected={!value}
                onClick={() => {
                  onSelect("");
                  setOpen(false);
                }}
                className="mp-picker__opt mp-picker__opt--none shrink-0"
              >
                <Icon name="circle-slash-2" size={14} />
                None
              </button>
            )}
            {options.map((o) => {
              const selected = value === o.name;
              return (
                // Monday-style solid tile in the option's own color; text flips black/white by lightness.
                <div
                  key={o.name}
                  role="option"
                  aria-selected={selected}
                  style={{ "--c": o.color } as VarStyle}
                  className="mp-picker__opt shrink-0 !cursor-default !p-0"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(o.name);
                      setOpen(false);
                    }}
                    className="flex h-full flex-1 min-w-0 items-center gap-1.5 pl-3 text-left cursor-pointer"
                  >
                    {o.emoji && <span aria-hidden>{o.emoji}</span>}
                    <span className="truncate">{o.name}</span>
                    {selected && <Icon name="check" size={14} className="ml-auto shrink-0" />}
                  </button>
                  <span className="w-2 shrink-0" />
                  {onColorChange && o.id != null && (
                    <span className="mr-2 flex shrink-0">
                      <ColorEdit initial={o.color} onCommit={(c) => onColorChange(o.id as number, c)} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        // The badge is the control (edit in place): solid in the picked color, outline when unset.
        className={`mp-badge mp-badge--chevron ${current ? "mp-badge--solid" : "mp-badge--outline"} max-w-44 disabled:opacity-50 disabled:cursor-not-allowed`}
        style={current ? ({ "--c": current.color } as VarStyle) : undefined}
        title="Click to assign"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="mp-badge__label">{value || placeholder}</span>
      </button>
      {menu}
    </>
  );
}

// Live preview in the swatch; persists once on blur (one save per edit).
function ColorEdit({ initial, onCommit }: { initial: string; onCommit: (c: string) => void }) {
  const [c, setC] = useState(toHexInput(initial));
  return (
    <input
      type="color"
      value={c}
      onChange={(e) => setC(e.target.value)}
      onBlur={() => c !== toHexInput(initial) && onCommit(c)}
      onClick={(e) => e.stopPropagation()}
      title="Change this color"
      className="w-6 h-6 p-0 rounded border-0 bg-transparent cursor-pointer shrink-0"
    />
  );
}
