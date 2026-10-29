"use client";

import { useEffect, useState } from "react";
import { SPLASH_SEEN_KEY } from "@/lib/launch-splash";
import { ActivityIndicator } from "./ActivityIndicator";

// Measured from navigation start (performance.now()'s origin), so a slow load doesn't
// add this on top — it only stops a fast one from flashing the splash.
const MIN_VISIBLE_MS = 800;
const EXIT_MS = 350;

/**
 * Full-screen launch screen, like a native app's, shown once per browser session (a
 * cold open of the tab or home-screen app). It is server-rendered so it covers the
 * first paint, then fades out after hydration. Later reloads in the same session hide
 * it before paint via `html[data-splash="off"]` (see globals.css); if JS never loads,
 * a CSS failsafe hides it after a few seconds.
 */
export function LaunchSplash() {
  const [phase, setPhase] = useState<"shown" | "leaving" | "gone">("shown");

  useEffect(() => {
    try {
      sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
    } catch {
      // Private mode / storage disabled: the splash just shows on every load.
    }
    const wait = Math.max(0, MIN_VISIBLE_MS - performance.now());
    const leave = setTimeout(() => setPhase("leaving"), wait);
    const gone = setTimeout(() => setPhase("gone"), wait + EXIT_MS);
    return () => {
      clearTimeout(leave);
      clearTimeout(gone);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div
      id="launch-splash"
      aria-hidden="true"
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center gap-8 bg-neutral-50 dark:bg-neutral-950 transition-opacity duration-[350ms] ease-out ${
        phase === "leaving" ? "opacity-0 pointer-events-none" : ""
      }`}
    >
      <div
        className={`flex flex-col items-center gap-4 transition-transform duration-[350ms] ease-out ${
          phase === "leaving" ? "scale-110" : ""
        }`}
      >
        <div className="motion-safe:animate-[splash-pop_.6s_cubic-bezier(.34,1.56,.64,1)_both]">
          <AppMark />
        </div>
        <span className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100 motion-safe:animate-[rise_.4s_ease-out_.2s_both]">
          Billing
        </span>
      </div>
      <div className="text-neutral-400 dark:text-neutral-500 motion-safe:animate-[overlay-fade_.3s_ease-out_.45s_both]">
        <ActivityIndicator size={22} />
      </div>
    </div>
  );
}

// App-icon tile with a card glyph whose stripe sweeps a highlight across it.
function AppMark() {
  return (
    <div className="h-20 w-20 rounded-[22px] bg-gradient-to-br from-neutral-800 to-neutral-950 shadow-xl shadow-black/15 ring-1 ring-black/5 flex items-center justify-center overflow-hidden dark:from-white dark:to-neutral-300 dark:ring-white/10">
      <svg width="44" height="32" viewBox="0 0 44 32" fill="none" className="text-white dark:text-neutral-900">
        <defs>
          <linearGradient id="splash-sheen" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="currentColor" stopOpacity="0" />
            <stop offset=".5" stopColor="currentColor" stopOpacity=".55" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <clipPath id="splash-card">
            <rect x="1" y="1" width="42" height="30" rx="5" />
          </clipPath>
        </defs>
        <rect x="1" y="1" width="42" height="30" rx="5" stroke="currentColor" strokeWidth="2" />
        <rect x="1" y="8" width="42" height="5" fill="currentColor" />
        <rect x="6" y="20" width="9" height="5" rx="1.5" fill="currentColor" opacity=".7" />
        <rect x="19" y="21.5" width="14" height="2" rx="1" fill="currentColor" opacity=".45" />
        <g clipPath="url(#splash-card)">
          <rect
            x="-20"
            y="0"
            width="20"
            height="32"
            fill="url(#splash-sheen)"
            className="motion-safe:animate-[splash-sheen_1.4s_ease-in-out_.5s_infinite]"
          />
        </g>
      </svg>
    </div>
  );
}
