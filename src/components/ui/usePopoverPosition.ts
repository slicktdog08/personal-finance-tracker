"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

export interface PopoverPosition {
  left: number;
  top: number;
  /** Space left between the panel's top and the viewport bottom — apply with overflow-y-auto. */
  maxHeight: number;
}

// Shared placement for anchored popovers: clamps to both viewport edges
// horizontally, flips above the anchor when the panel wouldn't fit below, and
// re-places on scroll (capture, so scrolling any ancestor counts) and resize.
export function usePopoverPosition(
  anchorRef: RefObject<HTMLElement | null>,
  {
    width,
    estHeight = 400,
    open,
    align = "left",
  }: {
    width: number;
    /** Rough panel height, only used to decide whether to flip above the anchor. */
    estHeight?: number;
    open: boolean;
    align?: "left" | "right";
  },
): PopoverPosition | null {
  const [pos, setPos] = useState<PopoverPosition | null>(null);

  const place = useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    const raw = align === "right" ? r.right - width : r.left;
    const left = Math.min(Math.max(8, raw), Math.max(8, window.innerWidth - width - 8));
    const below = r.bottom + 4;
    const top =
      below + estHeight > window.innerHeight ? Math.max(8, r.top - estHeight - 4) : below;
    setPos({ left, top, maxHeight: window.innerHeight - top - 8 });
  }, [anchorRef, width, estHeight, align]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, place]);

  // Stale coordinates are kept while closed; callers only read this when open.
  return open ? pos : null;
}
