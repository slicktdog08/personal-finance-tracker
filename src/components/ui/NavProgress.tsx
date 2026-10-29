"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { NAV_START_EVENT, type NavStartDetail } from "@/lib/nav-events";
import { ActivityIndicator } from "./ActivityIndicator";

// Prefetched navigations finish within a frame or two; the delays keep those from
// flashing anything. The spinner only follows page changes — filter and month changes
// (search params only) keep their current content on screen, so the bar is enough.
const BAR_DELAY_MS = 120;
const SPINNER_DELAY_MS = 600;
// A navigation that never changes the URL (e.g. a redirect back to the current page)
// would otherwise leave the bar parked at 90%.
const GIVE_UP_MS = 15_000;

const normalize = (pathname: string, search: string) => {
  const qs = new URLSearchParams(search).toString();
  return qs ? `${pathname}?${qs}` : pathname;
};

/**
 * Top-of-screen progress bar plus a delayed centre spinner for client navigations.
 * Start comes from onRouterTransitionStart (src/instrumentation-client.ts); the end is
 * the rendered URL changing, which is when the new page has committed.
 */
export function NavProgress() {
  const pathname = usePathname();
  const current = normalize(pathname, useSearchParams().toString());

  const barRef = useRef<HTMLDivElement>(null);
  const grow = useRef<Animation | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pending = useRef(false);
  const rendered = useRef({ pathname, current });
  const [spinner, setSpinner] = useState(false);

  // The new page committing hides the spinner. Adjusted during render (the project's
  // lint bans synchronous setState in effects), like Nav's drawer reset.
  const [lastPath, setLastPath] = useState(current);
  if (lastPath !== current) {
    setLastPath(current);
    setSpinner(false);
  }

  const finish = useEffectEvent(() => {
    pending.current = false;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const bar = barRef.current;
    if (!bar || !grow.current) return;
    // Hand off from wherever the grow animation got to, rather than jumping.
    const from = getComputedStyle(bar).transform;
    grow.current.cancel();
    grow.current = null;
    bar.animate(
      [
        { transform: from, opacity: 1 },
        { transform: "scaleX(1)", opacity: 1, offset: 0.4 },
        { transform: "scaleX(1)", opacity: 0 },
      ],
      { duration: 450, easing: "ease-out" },
    );
  });

  useEffect(() => {
    const onStart = (e: Event) => {
      const { url } = (e as CustomEvent<NavStartDetail>).detail;
      const target = new URL(url, window.location.href);
      const next = normalize(target.pathname, target.search);
      // Same-URL navigations (tapping the active nav link, hash jumps) render nothing
      // new, so there would be no URL change to end on.
      if (next === rendered.current.current) return;

      timers.current.forEach(clearTimeout);
      pending.current = true;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      timers.current = [
        setTimeout(() => {
          const bar = barRef.current;
          if (!bar || grow.current) return;
          // Fast at first, then crawls — reads as progress without claiming to know it.
          grow.current = bar.animate(
            [
              { transform: "scaleX(0)", opacity: 1 },
              { transform: "scaleX(0.9)", opacity: 1 },
            ],
            { duration: reduced ? 1 : 10_000, easing: "cubic-bezier(.08,.82,.17,1)", fill: "forwards" },
          );
        }, BAR_DELAY_MS),
        setTimeout(() => {
          if (target.pathname !== rendered.current.pathname) setSpinner(true);
        }, SPINNER_DELAY_MS),
        setTimeout(() => {
          setSpinner(false);
          finish();
        }, GIVE_UP_MS),
      ];
    };
    window.addEventListener(NAV_START_EVENT, onStart);
    return () => {
      window.removeEventListener(NAV_START_EVENT, onStart);
      timers.current.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    rendered.current = { pathname, current };
    if (pending.current) finish();
  }, [pathname, current]);

  return (
    <>
      <div
        ref={barRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] origin-left scale-x-0 opacity-0 bg-neutral-900 dark:bg-white"
      />
      {spinner && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center">
          <div className="rounded-2xl bg-white/90 p-4 text-neutral-500 shadow-lg ring-1 ring-black/5 backdrop-blur-md motion-safe:animate-[overlay-fade_.2s_ease-out] dark:bg-neutral-800/90 dark:text-neutral-300 dark:ring-white/10">
            <ActivityIndicator size={28} />
          </div>
        </div>
      )}
    </>
  );
}
