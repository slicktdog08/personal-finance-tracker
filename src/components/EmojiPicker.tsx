"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EMOJI_GROUPS } from "@/constants/emoji";

// A small, dependency-free emoji picker over a curated native set. Opens in a portal
// (so it isn't clipped by overflow) and supports search + clear.
export function EmojiPicker({
  value,
  onSelect,
  disabled = false,
  className = "",
  title = "Pick an emoji",
}: {
  value: string | null | undefined;
  onSelect: (emoji: string | null) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 288;
    // Keep the popover within the viewport horizontally.
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    setRect({ left, top: r.bottom + 4 });
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

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return EMOJI_GROUPS;
    return EMOJI_GROUPS.map((g) => ({
      ...g,
      emojis: g.emojis.filter(
        (e) => e.includes(query) || (g.keywords?.[e] ?? "").toLowerCase().includes(q),
      ),
    })).filter((g) => g.emojis.length > 0);
  }, [q, query]);

  const pick = (e: string) => {
    onSelect(e);
    setOpen(false);
    setQuery("");
  };

  const menu =
    open && rect
      ? createPortal(
          <div
            ref={menuRef}
            data-popover-root=""
            style={{ position: "fixed", left: rect.left, top: rect.top, width: 288 }}
            className="z-[60] rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl p-2"
          >
            <div className="flex items-center gap-2 mb-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search emoji…"
                autoFocus
                className="flex-1 border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700"
              />
              <button
                type="button"
                onClick={() => {
                  onSelect(null);
                  setOpen(false);
                  setQuery("");
                }}
                className="text-xs text-neutral-500 hover:text-red-600 hover:underline shrink-0"
                title="Remove emoji"
              >
                Clear
              </button>
            </div>
            <div className="max-h-64 overflow-auto pr-1">
              {filtered.map((g) => (
                <div key={g.label} className="mb-2">
                  <div className="text-[10px] uppercase tracking-wide text-neutral-400 px-1 mb-1">
                    {g.label}
                  </div>
                  <div className="grid grid-cols-8 gap-0.5">
                    {g.emojis.map((e) => (
                      <button
                        key={e + g.label}
                        type="button"
                        onClick={() => pick(e)}
                        className={`h-8 w-8 flex items-center justify-center rounded text-xl leading-none hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                          value === e ? "ring-2 ring-blue-500" : ""
                        }`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="text-xs text-neutral-500 px-1 py-3 text-center">No matches.</p>
              )}
            </div>
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
        title={title}
        aria-label={title}
        className={`h-9 w-9 flex items-center justify-center rounded-md border border-neutral-300 dark:border-neutral-700 bg-white/70 dark:bg-neutral-800/70 text-xl leading-none hover:border-blue-400 disabled:opacity-50 ${className}`}
      >
        {value || <span className="text-neutral-400 text-base">＋</span>}
      </button>
      {menu}
    </>
  );
}
