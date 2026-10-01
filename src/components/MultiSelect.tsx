"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePopoverPosition } from "@/components/ui/usePopoverPosition";

export interface MultiOption {
  value: string;
  label: string;
}

const MENU_W = 256;
const MENU_MAX_H = 288;

// Controlled checkbox dropdown: the parent owns `value` and reacts to `onChange`.
// Renders a summary button ("All" / the single label / "N selected") and a
// scrollable checkbox list, portaled to <body> and clamped to the viewport so it
// can't clip off-screen.
export function MultiSelect({
  options,
  value,
  onChange,
  allLabel = "All",
}: {
  options: MultiOption[];
  value: string[];
  onChange: (next: string[]) => void;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pos = usePopoverPosition(btnRef, { width: MENU_W, estHeight: MENU_MAX_H, open });

  // Close the dropdown when clicking outside the trigger and the portaled menu.
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

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  const summary =
    value.length === 0
      ? allLabel
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? "1 selected")
        : `${value.length} selected`;

  const buttonCls =
    "w-full sm:w-44 flex items-center justify-between gap-2 border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";

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
            className="z-50 overflow-auto rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg p-1"
          >
            {value.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full text-left px-2 py-1 text-xs text-neutral-500 hover:underline"
              >
                Clear selection
              </button>
            )}
            {options.length === 0 ? (
              <div className="px-2 py-1 text-sm text-neutral-500">No options</div>
            ) : (
              options.map((o) => (
                <label
                  key={o.value}
                  className="flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={value.includes(o.value)}
                    onChange={() => toggle(o.value)}
                  />
                  <span className="truncate">{o.label}</span>
                </label>
              ))
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button ref={btnRef} type="button" onClick={() => setOpen((o) => !o)} className={buttonCls}>
        <span className="truncate">{summary}</span>
        <span className="text-neutral-400">▾</span>
      </button>
      {menu}
    </>
  );
}
