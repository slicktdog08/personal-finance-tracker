"use client";

import { useCallback, useSyncExternalStore } from "react";

// SSR-safe: false on the server and first client render, then live-updates.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// Tailwind's `md` breakpoint — the line where bottom sheets become popovers/dialogs.
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 48rem)");
}
