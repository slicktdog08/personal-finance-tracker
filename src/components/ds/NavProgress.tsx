"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { NAV_START_EVENT, SKELETON_EVENT, type NavStartDetail, type SkeletonDetail } from "@/lib/nav-events";
import { ActivityIndicator } from "./ActivityIndicator";

// Prefetched navigations commit within a frame or two; the delay keeps those from flashing
// the bar. The spinner is a fallback for page changes that have no skeleton on screen after
// half a second (routes without a loading.tsx, or a cold first visit).
const BAR_DELAY_MS = 80;
const SPINNER_DELAY_MS = 500;
// A navigation whose end we never see (a cancelled fetch, an error boundary) would otherwise
// leave the bar parked near the end.
const GIVE_UP_MS = 10_000;
// Where the crawl parks until the page lands; the finish takes it the rest of the way.
const CRAWL_TO = 0.92;

const normalize = (pathname: string, search: string) => {
  const qs = new URLSearchParams(search).toString();
  return qs ? `${pathname}?${qs}` : pathname;
};

/** The bar's current scaleX, read off its computed transform ("matrix(a, b, c, d, tx, ty)"). */
function scaleOf(el: HTMLElement) {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  const a = parseFloat(t.slice("matrix(".length));
  return Number.isFinite(a) ? a : 0;
}

/**
 * Top-of-screen progress bar plus a delayed centre spinner for client navigations. Start comes
 * from onRouterTransitionStart (src/instrumentation-client.ts). The end is the latest target
 * URL having rendered — or a redirect landing somewhere nobody asked for — with no route
 * skeleton (<PageSkeleton>) still mounted, i.e. the page is really on screen.
 *
 * The bar only ever moves forward. A navigation that starts while the bar is still up (a
 * debounced filter firing again, a quick second tap, the finish still fading) resumes from
 * wherever the bar is; an older navigation committing underneath a newer one doesn't end it.
 */
export function NavProgress() {
  const pathname = usePathname();
  const current = normalize(pathname, useSearchParams().toString());

  const barRef = useRef<HTMLDivElement>(null);
  const anim = useRef<Animation | null>(null);
  const phase = useRef<"idle" | "growing" | "finishing">("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pending = useRef(false);
  const reached = useRef(false);
  const skeletons = useRef(0);
  // Every target navigated to since the bar came up, and the newest of them.
  const targets = useRef(new Set<string>());
  const latest = useRef<string | null>(null);
  const rendered = useRef({ pathname, current });
  const [spinner, setSpinner] = useState(false);

  // The new page committing hides the spinner. Adjusted during render (the project's lint bans
  // synchronous setState in effects), like AppShell's More-sheet reset.
  const [lastPath, setLastPath] = useState(current);
  if (lastPath !== current) {
    setLastPath(current);
    setSpinner(false);
  }

  const grow = useEffectEvent((from: number) => {
    const bar = barRef.current;
    if (!bar) return;
    anim.current?.cancel();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Never behind where it already is: resuming from past the crawl point just holds there.
    const to = Math.max(CRAWL_TO, from);
    const remaining = (to - from) / CRAWL_TO;
    // Fast at first, then crawls — reads as progress without claiming to know it. A resume
    // keeps a gentler curve so it doesn't lurch.
    anim.current = bar.animate(
      [
        { transform: `scaleX(${from})`, opacity: 1 },
        { transform: `scaleX(${to})`, opacity: 1 },
      ],
      {
        duration: reduced ? 1 : Math.max(300, 12_000 * remaining),
        easing: from > 0 ? "cubic-bezier(.2,.6,.3,1)" : "cubic-bezier(.08,.82,.17,1)",
        fill: "forwards",
      },
    );
    phase.current = "growing";
  });

  const finish = useEffectEvent(() => {
    pending.current = false;
    reached.current = false;
    targets.current.clear();
    latest.current = null;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setSpinner(false);
    const bar = barRef.current;
    if (!bar || phase.current !== "growing") return;
    // Hand off from wherever the crawl got to, rather than jumping.
    const from = scaleOf(bar);
    anim.current?.cancel();
    const done = bar.animate(
      [
        { transform: `scaleX(${from})`, opacity: 1 },
        { transform: "scaleX(1)", opacity: 1, offset: 0.35 },
        { transform: "scaleX(1)", opacity: 0 },
      ],
      { duration: 420, easing: "ease-out" },
    );
    anim.current = done;
    phase.current = "finishing";
    // A cancelled animation never fires this, which is what we want: a navigation that resumes
    // mid-fade takes over the phase itself.
    done.onfinish = () => {
      if (anim.current === done) {
        anim.current = null;
        phase.current = "idle";
      }
    };
  });

  const settle = useEffectEvent(() => {
    if (pending.current && reached.current && skeletons.current === 0) finish();
  });

  useEffect(() => {
    const onStart = (e: Event) => {
      const { url } = (e as CustomEvent<NavStartDetail>).detail;
      const target = new URL(url, window.location.href);
      const next = normalize(target.pathname, target.search);
      // Same-URL navigations (tapping the active tab, hash jumps) render nothing new, so there
      // would be no URL change to end on.
      if (next === rendered.current.current) return;

      timers.current.forEach(clearTimeout);
      pending.current = true;
      reached.current = false;
      latest.current = next;
      targets.current.add(next);

      const bar = barRef.current;
      if (phase.current === "finishing" && bar) {
        // Still fading from the last one: pick it up where it is instead of starting over.
        grow(scaleOf(bar));
      }
      timers.current = [
        setTimeout(() => {
          if (phase.current === "idle") grow(0);
        }, BAR_DELAY_MS),
        setTimeout(() => {
          if (target.pathname !== rendered.current.pathname && skeletons.current === 0) setSpinner(true);
        }, SPINNER_DELAY_MS),
        setTimeout(finish, GIVE_UP_MS),
      ];
    };
    const onSkeleton = (e: Event) => {
      skeletons.current = Math.max(0, skeletons.current + (e as CustomEvent<SkeletonDetail>).detail.delta);
      settle();
    };
    window.addEventListener(NAV_START_EVENT, onStart);
    window.addEventListener(SKELETON_EVENT, onSkeleton);
    return () => {
      window.removeEventListener(NAV_START_EVENT, onStart);
      window.removeEventListener(SKELETON_EVENT, onSkeleton);
      timers.current.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    rendered.current = { pathname, current };
    if (!pending.current) return;
    // Done when the newest target landed, or when the URL went somewhere no pending navigation
    // asked for (a redirect, e.g. /months → /months/2026-10). An *older* target landing means a
    // newer navigation is still in flight, so the bar keeps going.
    if (current !== latest.current && targets.current.has(current)) return;
    reached.current = true;
    // A skeleton committed in this same render announces itself from its own effect, which may
    // run after this one; a macrotask lets that land before deciding whether we're done.
    const t = setTimeout(settle, 0);
    return () => clearTimeout(t);
  }, [pathname, current]);

  return (
    <>
      <div ref={barRef} className="mp-navbar" aria-hidden="true" />
      {spinner && (
        <div className="mp-navspinner">
          <div className="mp-navspinner__pill">
            <ActivityIndicator size={28} />
          </div>
        </div>
      )}
    </>
  );
}
