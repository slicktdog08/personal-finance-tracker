"use client";

import { useEffect, useState } from "react";
import { SPLASH_SEEN_KEY } from "@/lib/launch-splash";
import { ActivityIndicator } from "./ActivityIndicator";
import { Wordmark } from "./brand";

// All measured from navigation start (performance.now()'s origin). The minimum gives the mark
// time to draw itself on a fast load; the cap means a stalled stream can never hold the app.
const MIN_VISIBLE_MS = 1150;
const MAX_HOLD_MS = 6000;
// Long enough for the coin's toss (the longest exit keyframe in motion.css) to finish.
const EXIT_MS = 700;

/**
 * Full-screen launch screen, like a native app's, shown once per browser session (a cold open
 * of the tab or of the Home Screen app). It is in the first bytes of the document — the root
 * layout returns before any session or database work — so it covers the first paint. It stays
 * up until the document has finished streaming (window load: the page's content is in, not
 * just its skeleton), then hands off to the finished screen. Later loads in the same session
 * hide it before paint via html[data-splash="off"] (motion.css); if JS never loads, a CSS
 * failsafe hides it.
 */
export function LaunchSplash() {
  const [phase, setPhase] = useState<"shown" | "leaving" | "gone">("shown");

  useEffect(() => {
    try {
      sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
    } catch {
      // Private mode / storage disabled: the splash just shows on every load.
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, Math.max(0, ms - performance.now())));
    let leaving = false;
    const leave = () => {
      if (leaving) return;
      leaving = true;
      setPhase("leaving");
      timers.push(setTimeout(() => setPhase("gone"), EXIT_MS));
    };
    // Content is in: go, but not before the mark has finished drawing.
    const ready = () => at(MIN_VISIBLE_MS, leave);
    if (document.readyState === "complete") ready();
    else window.addEventListener("load", ready, { once: true });
    at(MAX_HOLD_MS, leave);
    return () => {
      window.removeEventListener("load", ready);
      timers.forEach(clearTimeout);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div className="mp-splash" data-phase={phase} aria-hidden="true">
      <div className="mp-splash__stage">
        <AnimatedMark />
        <Wordmark size={30} className="mp-splash__word" />
      </div>
      <div className="mp-splash__wait">
        <ActivityIndicator size={22} />
      </div>
    </div>
  );
}

// The BrandMark geometry (brand.tsx) with every stroke on its own class so motion.css can draw
// them on in order. pathLength="1" lets the dash offsets be unit-free. The wrapper is what the
// entry/exit keyframes move (and carries the glow), so the SVG itself is never filtered.
function AnimatedMark() {
  return (
    <div className="mp-splash__coin">
      <AnimatedMarkSvg />
    </div>
  );
}

function AnimatedMarkSvg() {
  return (
    <svg className="mp-splash__svg" viewBox="0 0 96 96" width="104" height="104" aria-hidden="true">
      <defs>
        <clipPath id="mp-splash-face">
          <circle cx="48" cy="48" r="44" />
        </clipPath>
        <linearGradient id="mp-splash-shine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="48" cy="48" r="44" fill="var(--mp-accent)" />
      <g clipPath="url(#mp-splash-face)">
        <rect className="mp-splash__shine" x="-24" y="-10" width="30" height="116" fill="url(#mp-splash-shine)" />
      </g>
      <circle
        className="mp-splash__rim"
        cx="48"
        cy="48"
        r="37"
        fill="none"
        stroke="var(--mp-accent-ink)"
        strokeOpacity=".38"
        strokeWidth="2.5"
        pathLength={1}
      />
      <path
        className="mp-splash__glyph"
        d="M27 68V44a10.5 10.5 0 0 1 21 0v24M48 44a10.5 10.5 0 0 1 21 0v24"
        fill="none"
        stroke="var(--mp-accent-ink)"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
      />
      <path className="mp-splash__bar" d="M17 60h62" fill="none" stroke="var(--mp-accent-ink)" strokeWidth="6" strokeLinecap="round" pathLength={1} />
      <path
        className="mp-splash__glint"
        d="M63 15.5a35 35 0 0 1 16.5 15"
        fill="none"
        stroke="var(--mp-accent-soft-2)"
        strokeOpacity=".9"
        strokeWidth="5"
        strokeLinecap="round"
        pathLength={1}
      />
    </svg>
  );
}
