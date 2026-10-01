"use client";

import { useEffect, useState } from "react";

// Keeps a closable surface mounted for `duration` ms after `open` flips false so
// its exit animation can play; `closing` is true during that window. Mounting on
// open is a render-time state adjustment (the project's lint bans synchronous
// setState in effects); only the delayed unmount lives in an effect timer.
export function useExitTransition(open: boolean, duration = 250) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open || !mounted) return;
    const t = setTimeout(() => setMounted(false), duration);
    return () => clearTimeout(t);
  }, [open, mounted, duration]);

  return { mounted, closing: mounted && !open };
}
