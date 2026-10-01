"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { badgeStyle, toHexInput } from "@/lib/colors";

export interface ColorOption {
  id?: number;
  name: string;
  color: string;
  emoji?: string | null;
}

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
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, 210);
    // Clamp to the viewport — the menu opens from table cells and card rows that
    // can sit near (or past) the right edge on small screens.
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
    setRect({ left, top: r.bottom + 4, width });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    const onDoc = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.name === value);

  const menu =
    open && rect
      ? createPortal(
          <div
            ref={menuRef}
            data-popover-root=""
            style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width }}
            className="z-[60] max-h-72 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl p-1"
          >
            {allowEmpty && (
              <button
                type="button"
                onClick={() => {
                  onSelect("");
                  setOpen(false);
                }}
                className="w-full text-left px-2 py-1.5 rounded text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                — none —
              </button>
            )}
            {options.map((o) => {
              const selected = value === o.name;
              return (
                <div
                  key={o.name}
                  style={badgeStyle(o.color)}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 mb-0.5 last:mb-0 transition hover:ring-2 hover:ring-inset hover:ring-blue-500/70 ${
                    selected ? "ring-2 ring-inset ring-blue-500" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(o.name);
                      setOpen(false);
                    }}
                    className="flex-1 text-left min-w-0 flex items-center gap-1.5 cursor-pointer"
                  >
                    {o.emoji && <span aria-hidden>{o.emoji}</span>}
                    <span className={`truncate text-xs ${selected ? "font-bold" : "font-medium"}`}>
                      {o.name}
                    </span>
                  </button>
                  {selected && (
                    <span aria-hidden className="text-xs shrink-0">
                      ✓
                    </span>
                  )}
                  {onColorChange && o.id != null && (
                    <ColorEdit initial={o.color} onCommit={(c) => onColorChange(o.id as number, c)} />
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
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border-0 cursor-pointer max-w-44 disabled:opacity-50"
        style={current ? badgeStyle(current.color) : undefined}
        title="Click to assign"
      >
        {current?.emoji && <span aria-hidden>{current.emoji}</span>}
        <span className="truncate">{value || placeholder}</span>
        <span aria-hidden>▾</span>
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
