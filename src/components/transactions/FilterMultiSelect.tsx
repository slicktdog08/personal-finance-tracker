"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePopoverPosition } from "@/components/ui/usePopoverPosition";
import { Checkbox, cx } from "@/components/ds";

export interface FilterMultiOption {
  value: string;
  label: string;
}

const MENU_W = 256;
const MENU_MAX_H = 320;

// The filter bar's month / account / category pickers. Same contract as the shared
// MultiSelect (controlled, checkbox list portaled to <body> and clamped to the viewport), but
// drawn as an mp-select so it sits in the MiPlata FilterBar next to the search field. The
// summary names what's chosen ("All accounts" / the one label / "3 accounts") so the bar reads
// like the kit's single selects while still allowing several.
export function FilterMultiSelect({
  options,
  value,
  onChange,
  allLabel,
  noun,
  label,
  className,
}: {
  options: FilterMultiOption[];
  value: string[];
  onChange: (next: string[]) => void;
  /** Shown when nothing is picked, e.g. "All months". */
  allLabel: string;
  /** Plural for the "N months" summary. */
  noun: string;
  /** Accessible name for the trigger. */
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pos = usePopoverPosition(btnRef, { width: MENU_W, estHeight: MENU_MAX_H, open });

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
        : `${value.length} ${noun}`;

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            // Lets an anchored Sheet's outside-click ignore clicks in here (see Sheet.tsx).
            data-popover-root=""
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: MENU_W,
              maxHeight: Math.min(MENU_MAX_H, pos.maxHeight),
            }}
            className="z-[60] overflow-auto rounded-panel border border-line bg-raised shadow-overlay p-1.5"
          >
            {value.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full text-left px-2 py-1.5 text-xs font-medium text-accent-text hover:underline"
              >
                Clear selection
              </button>
            )}
            {options.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-fg-3">No options</div>
            ) : (
              options.map((o) => (
                <div key={o.value} className="rounded-control px-2 py-1 hover:bg-hover">
                  <Checkbox
                    checked={value.includes(o.value)}
                    onChange={() => toggle(o.value)}
                    label={<span className="truncate text-sm leading-snug">{o.label}</span>}
                    className="w-full min-w-0"
                  />
                </div>
              ))
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cx(
          "mp-select flex items-center text-left",
          value.length > 0 && "!border-accent text-accent-text",
          className,
        )}
      >
        <span className="truncate leading-snug">{summary}</span>
      </button>
      {menu}
    </>
  );
}
