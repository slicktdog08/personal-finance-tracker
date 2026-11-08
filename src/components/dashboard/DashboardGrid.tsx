"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { GripIcon } from "@/components/icons";
import { Icon, buttonClass } from "@/components/ds";
import { useMediaQuery } from "@/components/ui/useMediaQuery";
import { resetDashboardLayout, saveDashboardLayout } from "@/server/actions/layout";
import {
  H_STEP,
  MAX_H,
  MIN_H,
  MOBILE_COLS,
  colsOf,
  effectiveWidths,
  minWOf,
  moveItem,
  normalizeMobileLayout,
  sameLayout,
  type DashboardLayouts,
  type LayoutItem,
  type LayoutKind,
  type WidgetId,
} from "@/lib/dashboard-layout";

export interface DashboardWidget {
  id: WidgetId;
  /** Shown on the widget while customizing, and on the drag ghost. */
  title: string;
  node: ReactNode;
}

type SaveState = "idle" | "saving" | "saved" | "error";
/** A widget being dragged: where the pointer is, where on the widget it was grabbed, its size. */
type DragState = { id: WidgetId; x: number; y: number; grabX: number; grabY: number; w: number; h: number };
/** A gesture in progress, fed by mouse/pen pointer events or by touch events alike. */
type Gesture = { move: (x: number, y: number) => void; end: (cancelled: boolean) => void };

/** Tiles glide to their new places over this long (and ignore hover re-targeting meanwhile). */
const REFLOW_MS = 180;
/** Within this many px of the viewport's top/bottom edge the page scrolls while dragging. */
const EDGE = 72;
/** Touch: hold this long without moving to pick a widget up — anything quicker is a scroll. */
const HOLD_MS = 350;
/** Touch: moving further than this before the hold completes means the finger is scrolling. */
const HOLD_SLOP = 8;
type Axis = "x" | "y" | "xy";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const DESKTOP_QUERY = "(min-width: 64rem)"; // Tailwind's lg — where the 12-column layout applies

/**
 * The height a widget would have if it just fit its content: its fixed height and the grid row's
 * stretch both lifted for one synchronous measurement (no paint happens in between).
 */
function naturalHeight(el: HTMLElement): number {
  const inner = el.firstElementChild as HTMLElement | null;
  const card = inner?.firstElementChild as HTMLElement | null;
  const saved = [el, inner, card].map((n) => (n ? [n.style.height, n.style.alignSelf] : null));
  for (const n of [el, inner, card]) if (n) { n.style.height = "auto"; n.style.alignSelf = "start"; }
  const h = el.getBoundingClientRect().height;
  [el, inner, card].forEach((n, i) => { if (n && saved[i]) { n.style.height = saved[i]![0]; n.style.alignSelf = saved[i]![1]; } });
  return h;
}

/** Follow a mouse/pen pointer on window until it's released; Escape cancels. */
function trackPointer(g: Gesture): () => void {
  const move = (e: PointerEvent) => g.move(e.clientX, e.clientY);
  const up = () => finish(false);
  const cancel = () => finish(true);
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") finish(true);
  };
  function finish(cancelled: boolean) {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key);
    g.end(cancelled);
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key);
  return () => finish(true);
}

/**
 * Follow one finger until it lifts. Touch events rather than pointer events because only a
 * non-passive touchmove can stop the page from scrolling under a drag — with pointer events the
 * browser claims the touch for scrolling and sends pointercancel instead.
 */
function trackTouch(touchId: number, g: Gesture): () => void {
  const find = (list: TouchList) => Array.from(list).find((t) => t.identifier === touchId);
  const move = (e: TouchEvent) => {
    const t = find(e.changedTouches);
    if (!t) return;
    if (e.cancelable) e.preventDefault();
    g.move(t.clientX, t.clientY);
  };
  const end = (e: TouchEvent) => {
    if (find(e.changedTouches)) finish(e.type === "touchcancel");
  };
  function finish(cancelled: boolean) {
    window.removeEventListener("touchmove", move);
    window.removeEventListener("touchend", end);
    window.removeEventListener("touchcancel", end);
    g.end(cancelled);
  }
  window.addEventListener("touchmove", move, { passive: false });
  window.addEventListener("touchend", end);
  window.addEventListener("touchcancel", end);
  return () => finish(true);
}

/**
 * The dashboard's widgets on a grid that can be rearranged and resized in place — with one
 * arrangement for desktop (12 columns, lg+) and another for phones and tablets (2 columns). The
 * DOM follows the desktop order; below lg each widget's CSS `order`, span and height come from
 * the phone layout, so the server renders both correctly without knowing the screen size.
 *
 * "Customize" switches into edit mode, which edits whichever layout is on screen:
 * - mouse: drag a widget to move it; drag its right / bottom edge or corner to resize; double-click
 *   the bottom edge to fit the content again
 * - touch: hold a widget (or drag its label straight away) to move it; drag an edge or the corner
 *   knob to resize — the page keeps scrolling normally otherwise
 * - keyboard: arrows move, Shift + ←/→ changes the width
 * Every drop is saved to the server.
 */
export function DashboardGrid({
  initialLayouts,
  widgets,
  title,
  controls,
}: {
  initialLayouts: DashboardLayouts;
  widgets: DashboardWidget[];
  title: ReactNode;
  controls: ReactNode;
}) {
  const [layouts, setLayouts] = useState<Record<LayoutKind, LayoutItem[]>>({
    desktop: initialLayouts.desktop,
    mobile: initialLayouts.mobile,
  });
  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [resizing, setResizing] = useState<WidgetId | null>(null);
  // A finger is resting on this widget, maybe about to pick it up (drives the press feedback).
  const [pressing, setPressing] = useState<WidgetId | null>(null);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const kind: LayoutKind = isDesktop ? "desktop" : "mobile";
  const dragging = drag?.id ?? null;
  // Positions of every tile just before a drag reorders them, so the next layout can animate from
  // there (FLIP) instead of snapping — the snap is what made dragging feel jumpy.
  const flipFrom = useRef<Map<string, DOMRect> | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const layoutsRef = useRef(layouts);
  const savedRef = useRef<Record<LayoutKind, LayoutItem[]>>({ desktop: initialLayouts.desktop, mobile: initialLayouts.mobile });
  // Until the phone layout is saved once, it mirrors the desktop order (see normalizeMobileLayout).
  const mobileSavedRef = useRef(initialLayouts.mobileSaved);
  const saveSeq = useRef<Record<LayoutKind, number>>({ desktop: 0, mobile: 0 });
  const cleanupRef = useRef<(() => void) | null>(null);

  // A gesture in progress when the component goes away must not leave window listeners behind.
  useEffect(() => () => cleanupRef.current?.(), []);

  const byId = useMemo(() => new Map(widgets.map((w) => [w.id, w])), [widgets]);
  const present = useMemo(() => new Set(widgets.map((w) => w.id)), [widgets]);
  const desktopWidths = useMemo(() => effectiveWidths(layouts.desktop, present), [layouts.desktop, present]);
  const mobileWidths = useMemo(() => effectiveWidths(layouts.mobile, present, MOBILE_COLS), [layouts.mobile, present]);
  const shown = layouts.desktop.filter((l) => present.has(l.id));
  const mobileShown = layouts.mobile.filter((l) => present.has(l.id));
  const mobileIndex = new Map(mobileShown.map((l, i) => [l.id, i]));
  const mobileItem = new Map(layouts.mobile.map((l) => [l.id, l]));

  useLayoutEffect(() => {
    const from = flipFrom.current;
    flipFrom.current = null;
    const grid = gridRef.current;
    if (!from || !grid) return;
    for (const el of grid.querySelectorAll<HTMLElement>("[data-widget]")) {
      const was = from.get(el.dataset.widget!);
      if (!was) continue;
      const now = el.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = `transform ${REFLOW_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`;
        el.style.transform = "";
      });
    }
    // Also on drop (dragging → null): the dropped tile glides from where it was let go.
  }, [layouts, dragging]);

  function snapshotPositions() {
    const grid = gridRef.current;
    if (!grid) return;
    flipFrom.current = new Map([...grid.querySelectorAll<HTMLElement>("[data-widget]")].map((el) => [el.dataset.widget!, el.getBoundingClientRect()]));
  }

  // The ref is the source of truth during a gesture: a drop reads it to save, and it must already
  // hold the last move even if React hasn't rendered that move yet.
  function apply(k: LayoutKind, next: LayoutItem[]) {
    if (next === layoutsRef.current[k]) return;
    const all = { ...layoutsRef.current, [k]: next };
    // An uncustomized phone layout follows the desktop one as it changes.
    if (k === "desktop" && !mobileSavedRef.current) all.mobile = normalizeMobileLayout(null, next);
    layoutsRef.current = all;
    setLayouts(all);
  }

  async function persist(k: LayoutKind, next: LayoutItem[]) {
    if (sameLayout(next, savedRef.current[k])) return;
    const seq = ++saveSeq.current[k];
    setSaveState("saving");
    const res = await saveDashboardLayout(next, k);
    if (seq !== saveSeq.current[k]) return; // a newer save is in flight; let it report
    if (res.ok) {
      savedRef.current[k] = next;
      if (k === "mobile") mobileSavedRef.current = true;
      setSaveState("saved");
    } else setSaveState("error");
  }

  async function reset(k: LayoutKind) {
    const seq = ++saveSeq.current[k];
    setSaveState("saving");
    const res = await resetDashboardLayout(k);
    if (seq !== saveSeq.current[k]) return;
    if (res.ok && res.layout) {
      savedRef.current[k] = res.layout;
      if (k === "mobile") mobileSavedRef.current = false;
      apply(k, res.layout);
      setSaveState("saved");
    } else setSaveState("error");
  }

  /** Hand a gesture its input source; the gesture's own end() still runs on cancel/unmount. */
  function run(g: Gesture, source: (g: Gesture) => () => void) {
    cleanupRef.current = source({
      move: g.move,
      end: (cancelled) => {
        cleanupRef.current = null;
        g.end(cancelled);
      },
    });
  }

  /**
   * Moving a widget. With `armed` false the drag only begins once the pointer has travelled a few
   * px (a mouse click shouldn't lift anything); a touch hold arrives already armed.
   */
  function dragGesture(id: WidgetId, k: LayoutKind, x0: number, y0: number, armed: boolean): Gesture | null {
    const tile = gridRef.current?.querySelector<HTMLElement>(`[data-widget="${id}"]`);
    if (!tile) return null;
    const rect = tile.getBoundingClientRect();
    const before = layoutsRef.current[k];
    let started = false;
    let px = x0;
    let py = y0;
    let settleUntil = 0;
    let lastMove = "";
    let raf = 0;

    // Where would the dragged tile land with the pointer here? Over another tile, on the side of
    // its midpoint the pointer is on. Over the placeholder (its own slot) or a gap: stay put.
    const retarget = () => {
      if (performance.now() < settleUntil) return;
      const el = document.elementFromPoint(px, py)?.closest<HTMLElement>("[data-widget]");
      const target = el?.dataset.widget as WidgetId | undefined;
      if (!el || !target || target === id) return;
      const r = el.getBoundingClientRect();
      const gridW = gridRef.current?.getBoundingClientRect().width ?? r.width;
      // A full-width neighbour is above or below; anything narrower is beside.
      const after = r.width > gridW * 0.6 ? py > r.top + r.height / 2 : px > r.left + r.width / 2;
      const key = `${target}:${after}`;
      if (key === lastMove) return;
      const next = moveItem(layoutsRef.current[k], id, target, after);
      if (sameLayout(next, layoutsRef.current[k])) return;
      lastMove = key;
      // Tiles are about to glide; hit-testing them mid-glide is what made the order flap.
      settleUntil = performance.now() + REFLOW_MS;
      snapshotPositions();
      apply(k, next);
    };

    // Keeps scrolling while the pointer rests near an edge (not only while it moves), and keeps
    // the landing spot current as the page scrolls under a still pointer.
    const tick = () => {
      const speed = py < EDGE ? -(EDGE - py) / 3 : py > window.innerHeight - EDGE ? (py - (window.innerHeight - EDGE)) / 3 : 0;
      if (speed) {
        window.scrollBy(0, speed);
        retarget();
      }
      raf = requestAnimationFrame(tick);
    };

    const lift = () => {
      started = true;
      raf = requestAnimationFrame(tick);
    };
    const show = () => setDrag({ id, x: px, y: py, grabX: x0 - rect.left, grabY: y0 - rect.top, w: rect.width, h: rect.height });
    if (armed) {
      lift();
      show();
    }

    return {
      move: (x, y) => {
        px = x;
        py = y;
        if (!started) {
          if (Math.hypot(px - x0, py - y0) < 5) return;
          lift();
        }
        show();
        retarget();
      },
      end: (cancelled) => {
        cancelAnimationFrame(raf);
        if (cancelled) apply(k, before);
        if (started) {
          snapshotPositions();
          // The dropped tile animates from the floating copy's last position into its slot.
          flipFrom.current?.set(id, new DOMRect(px - (x0 - rect.left), py - (y0 - rect.top), rect.width, rect.height));
        }
        setDrag(null);
        if (started && !cancelled) void persist(k, layoutsRef.current[k]);
      },
    };
  }

  function resizeGesture(id: WidgetId, k: LayoutKind, axis: Axis, x0: number, y0: number): Gesture | null {
    const grid = gridRef.current;
    const el = grid?.querySelector<HTMLElement>(`[data-widget="${id}"]`);
    if (!grid || !el) return null;
    const rect = el.getBoundingClientRect();
    const cols = colsOf(k);
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
    const colW = (grid.getBoundingClientRect().width + gap) / cols;
    const fitH = naturalHeight(el);
    const before = layoutsRef.current[k];
    setResizing(id);
    return {
      move: (x, y) => {
        const cur = layoutsRef.current[k].find((l) => l.id === id);
        if (!cur) return;
        let { w, h } = cur;
        if (axis !== "y") w = clamp(Math.round((rect.width + gap + x - x0) / colW), minWOf(k), cols);
        if (axis !== "x") {
          const raw = rect.height + y - y0;
          // At or below the content's own height a fixed height buys nothing but clipping, so the
          // widget goes back to fitting its content. Without this, the first nudge on a short widget
          // (the attention pills) locked it at the minimum and it could never shrink back.
          h = raw <= fitH + H_STEP / 2 ? null : clamp(Math.round(raw / H_STEP) * H_STEP, Math.max(MIN_H, Math.ceil(fitH / H_STEP) * H_STEP), MAX_H);
        }
        if (w !== cur.w || h !== cur.h) apply(k, layoutsRef.current[k].map((l) => (l.id === id ? { ...l, w, h } : l)));
      },
      end: (cancelled) => {
        if (cancelled) apply(k, before);
        setResizing(null);
        if (!cancelled) void persist(k, layoutsRef.current[k]);
      },
    };
  }

  // ---- Input wiring: mouse/pen through pointer events, fingers through touch events ----

  function onPointerDrag(e: React.PointerEvent, id: WidgetId) {
    if (e.pointerType === "touch" || e.button !== 0) return; // touch is handled by onTouch*
    e.preventDefault();
    const g = dragGesture(id, kind, e.clientX, e.clientY, false);
    if (g) run(g, trackPointer);
  }

  /** The label chip: a finger on it drags at once — it's unambiguously the "move" handle. */
  function onTouchDragNow(e: React.TouchEvent, id: WidgetId) {
    e.stopPropagation();
    if (e.touches.length !== 1) return;
    const t = e.changedTouches[0];
    const g = dragGesture(id, kind, t.clientX, t.clientY, true);
    if (g) run(g, (gg) => trackTouch(t.identifier, gg));
  }

  /**
   * Anywhere else on a widget, a finger has to rest for HOLD_MS before the widget lifts. Moving
   * first means it's a scroll, and the browser gets to scroll as normal; nothing is prevented
   * until the hold completes.
   */
  function onTouchHold(e: React.TouchEvent, id: WidgetId) {
    if (e.touches.length !== 1 || cleanupRef.current) return;
    const t = e.changedTouches[0];
    const touchId = t.identifier;
    const k = kind;
    const x0 = t.clientX;
    const y0 = t.clientY;
    let x = x0;
    let y = y0;
    setPressing(id);
    const timer = window.setTimeout(() => {
      stop();
      const g = dragGesture(id, k, x0, y0, true);
      if (!g) return;
      navigator.vibrate?.(10);
      run(g, (gg) => trackTouch(touchId, gg));
      // The finger may already have drifted (within the slop) — start from where it is now.
      g.move(x, y);
    }, HOLD_MS);
    const move = (ev: TouchEvent) => {
      const tt = Array.from(ev.changedTouches).find((c) => c.identifier === touchId);
      if (!tt) return;
      x = tt.clientX;
      y = tt.clientY;
      if (Math.hypot(x - x0, y - y0) > HOLD_SLOP) stop();
    };
    const end = (ev: TouchEvent) => {
      if (Array.from(ev.changedTouches).some((c) => c.identifier === touchId)) stop();
    };
    function stop() {
      window.clearTimeout(timer);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
      window.removeEventListener("scroll", stop);
      setPressing(null);
      if (cleanupRef.current === stop) cleanupRef.current = null;
    }
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    // Momentum from an earlier fling still moving the page: this touch is part of a scroll.
    window.addEventListener("scroll", stop, { passive: true });
    cleanupRef.current = stop;
  }

  function onPointerResize(e: React.PointerEvent, id: WidgetId, axis: Axis) {
    if (e.pointerType === "touch" || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const g = resizeGesture(id, kind, axis, e.clientX, e.clientY);
    if (g) run(g, trackPointer);
  }

  function onTouchResize(e: React.TouchEvent, id: WidgetId, axis: Axis) {
    e.stopPropagation();
    if (e.touches.length !== 1) return;
    const t = e.changedTouches[0];
    const g = resizeGesture(id, kind, axis, t.clientX, t.clientY);
    if (g) run(g, (gg) => trackTouch(t.identifier, gg));
  }

  /** Apply a change from a button or key and save it straight away. */
  function commit(k: LayoutKind, next: LayoutItem[]) {
    if (next === layoutsRef.current[k]) return;
    apply(k, next);
    void persist(k, next);
  }

  /** Keyboard / button move: swap places with the neighbouring widget that's on screen. */
  function shift(id: WidgetId, delta: -1 | 1) {
    const order = kind === "desktop" ? shown : mobileShown;
    const i = order.findIndex((l) => l.id === id);
    const neighbour = order[i + delta];
    if (neighbour) commit(kind, moveItem(layoutsRef.current[kind], id, neighbour.id, delta > 0));
  }

  function setWidth(id: WidgetId, w: number) {
    const ww = clamp(w, minWOf(kind), colsOf(kind));
    commit(kind, layoutsRef.current[kind].map((l) => (l.id === id ? { ...l, w: ww } : l)));
  }

  function setAutoHeight(id: WidgetId) {
    commit(kind, layoutsRef.current[kind].map((l) => (l.id === id ? { ...l, h: null } : l)));
  }

  return (
    <div className="space-y-4 lg:space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-2">
        {title}
        <div className="flex items-center gap-2">
          {controls}
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-pressed={editing}
            title={editing ? "Finish customizing" : "Rearrange and resize widgets"}
            className={buttonClass({ variant: editing ? "primary" : "secondary", size: "sm" })}
          >
            <Icon name={editing ? "check" : "pencil-line"} size={15} />
            <span className={editing ? "" : "hidden sm:inline"}>{editing ? "Done" : "Customize"}</span>
          </button>
        </div>
      </div>

      {editing && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-fg">
          <span className="flex-1 min-w-0">
            {kind === "desktop" ? (
              <>Drag a widget to move it. Drag its right or bottom edge to resize; double-click the bottom edge to fit the content again.</>
            ) : (
              <>
                Hold a widget, or drag its label, to move it. Drag the corner to resize. This arranges the{" "}
                <strong className="font-semibold">phone</strong> layout — desktop keeps its own.
              </>
            )}
          </span>
          <span className="tabular-nums text-accent-text" aria-live="polite">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Couldn't save — try again" : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              const what = kind === "desktop" ? "the desktop layout" : "the phone layout (it will follow the desktop order again)";
              if (window.confirm(`Reset ${what}?`)) void reset(kind);
            }}
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            <Icon name="rotate-ccw" size={15} />
            Reset layout
          </button>
        </div>
      )}

      <div ref={gridRef} className="grid grid-cols-2 lg:grid-cols-12 gap-3 md:gap-4 lg:gap-5">
        {shown.map((l) => {
          const wdg = byId.get(l.id)!;
          const m = mobileItem.get(l.id) ?? { id: l.id, w: MOBILE_COLS, h: null };
          const w = desktopWidths.get(l.id) ?? l.w;
          const mw = mobileWidths.get(l.id) ?? m.w;
          // Both layouts ride along as custom properties; the breakpoint picks which one applies.
          const vars = {
            "--w": `span ${w} / span ${w}`,
            "--mw": `span ${mw} / span ${mw}`,
            "--mo": mobileIndex.get(l.id) ?? 0,
            "--h": l.h != null ? `${l.h}px` : undefined,
            "--mh": m.h != null ? `${m.h}px` : undefined,
          } as CSSProperties;
          const place = `relative min-w-0 max-lg:[grid-column:var(--mw)] max-lg:[order:var(--mo)] lg:[grid-column:var(--w)]`;
          // What the edit controls act on: the layout for the screen in use.
          const cur = kind === "desktop" ? { w, h: l.h } : { w: mw, h: m.h };
          const cols = colsOf(kind);
          const active = resizing === l.id;
          if (drag && dragging === l.id)
            return (
              // Where the tile will land: its own size, reserved in the grid flow.
              <div
                key={l.id}
                data-widget={l.id}
                style={{ ...vars, height: drag.h }}
                className={`${place} grid place-items-center rounded-card border-2 border-dashed border-accent bg-accent/[0.07]`}
              >
                <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-accent-text shadow-hairline">
                  {wdg.title} lands here
                </span>
              </div>
            );
          return (
            <div
              key={l.id}
              data-widget={l.id}
              style={vars}
              className={`group/widget ${place} ${l.h != null ? "lg:[height:var(--h)]" : ""} ${m.h != null ? "max-lg:[height:var(--mh)]" : ""}`}
            >
              <div
                className={`h-full [&>*]:h-full ${l.h != null ? "lg:[&>*]:overflow-y-auto" : ""} ${m.h != null ? "max-lg:[&>*]:overflow-y-auto" : ""} ${
                  editing ? "pointer-events-none select-none" : ""
                }`}
                // Links and buttons inside a widget must not be reachable while it's a drag target.
                inert={editing}
              >
                {wdg.node}
              </div>

              {editing && (
                <div
                  onPointerDown={(e) => onPointerDrag(e, l.id)}
                  onTouchStart={(e) => onTouchHold(e, l.id)}
                  // A long press would otherwise open the context menu (Android) or callout (iOS).
                  onContextMenu={(e) => e.preventDefault()}
                  className={`absolute inset-0 rounded-card outline-2 outline-dashed outline-offset-2 select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent] transition-[background-color,transform] ${
                    active ? "outline-accent bg-accent/10" : "outline-accent/40 bg-accent/[0.03] hover:bg-accent/[0.07]"
                  } ${pressing === l.id ? "scale-[0.98] bg-accent/10 duration-300 delay-100" : "duration-150"} cursor-grab active:cursor-grabbing`}
                >
                  <div className="absolute top-1.5 left-1.5 right-1.5 flex items-center gap-1 pointer-events-none">
                    <button
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onPointerDrag(e, l.id);
                      }}
                      onTouchStart={(e) => onTouchDragNow(e, l.id)}
                      onKeyDown={(e) => {
                        const k = e.key;
                        if (e.shiftKey && (k === "ArrowLeft" || k === "ArrowRight")) setWidth(l.id, cur.w + (k === "ArrowRight" ? 1 : -1));
                        else if (k === "ArrowLeft" || k === "ArrowUp") shift(l.id, -1);
                        else if (k === "ArrowRight" || k === "ArrowDown") shift(l.id, 1);
                        else return;
                        e.preventDefault();
                      }}
                      aria-label={`Move ${wdg.title}. Arrow keys move it; Shift + left/right changes its width.`}
                      title="Drag to move · arrow keys move · Shift+←/→ resize"
                      className="pointer-events-auto touch-none inline-flex items-center gap-1 rounded-md bg-surface/95 border border-neutral-200 dark:border-neutral-700 shadow-sm pl-1 pr-2 py-0.5 pointer-coarse:py-1.5 pointer-coarse:pr-2.5 text-[11px] font-medium text-neutral-700 dark:text-neutral-200 cursor-grab max-w-full min-w-0"
                    >
                      <GripIcon width={14} height={14} className="shrink-0 text-neutral-400" />
                      <span className="truncate">{wdg.title}</span>
                    </button>
                    <span className="flex-1" />
                    <span className="inline-flex shrink-0 items-center gap-0.5 pointer-events-auto rounded-md bg-surface/95 border border-neutral-200 dark:border-neutral-700 shadow-sm text-[11px] tabular-nums text-neutral-600 dark:text-neutral-300">
                      {kind === "desktop" ? (
                        <>
                          <SizeButton label="Narrower" disabled={cur.w <= minWOf(kind)} onClick={() => setWidth(l.id, cur.w - 1)}>
                            −
                          </SizeButton>
                          <span className="px-0.5" title={`Columns wide, of ${cols}`}>
                            {cur.w}/{cols}
                          </span>
                          <SizeButton label="Wider" disabled={cur.w >= cols} onClick={() => setWidth(l.id, cur.w + 1)}>
                            +
                          </SizeButton>
                        </>
                      ) : (
                        // Two columns on a phone: the only widths are half and full.
                        <SizeButton
                          label={cur.w >= cols ? "Make half width" : "Make full width"}
                          onClick={() => setWidth(l.id, cur.w >= cols ? 1 : cols)}
                          wide
                        >
                          {cur.w >= cols ? "Full" : "Half"} ⇆
                        </SizeButton>
                      )}
                      {cur.h != null && (
                        <SizeButton label="Fit height to content" onClick={() => setAutoHeight(l.id)} wide>
                          auto ↕
                        </SizeButton>
                      )}
                    </span>
                  </div>

                  {/* Resize handles. Fingers get bigger targets (pointer-coarse); touch-none keeps a
                      finger on a handle from scrolling the page instead. */}
                  <div
                    onPointerDown={(e) => onPointerResize(e, l.id, "x")}
                    onTouchStart={(e) => onTouchResize(e, l.id, "x")}
                    className="absolute z-10 top-8 bottom-6 -right-2 w-3 pointer-coarse:-right-3.5 pointer-coarse:w-7 cursor-ew-resize touch-none group/handle"
                    title="Drag to change width"
                  >
                    <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 rounded-full bg-accent/0 group-hover/handle:bg-accent/80 pointer-coarse:bg-accent/40" />
                  </div>
                  <div
                    onPointerDown={(e) => onPointerResize(e, l.id, "y")}
                    onTouchStart={(e) => onTouchResize(e, l.id, "y")}
                    onDoubleClick={() => setAutoHeight(l.id)}
                    className="absolute z-10 left-6 right-8 -bottom-2 h-3 pointer-coarse:right-10 pointer-coarse:-bottom-3.5 pointer-coarse:h-7 cursor-ns-resize touch-none group/handle"
                    title="Drag to change height · double-click to fit content"
                  >
                    <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-accent/0 group-hover/handle:bg-accent/80 pointer-coarse:bg-accent/40" />
                  </div>
                  <div
                    onPointerDown={(e) => onPointerResize(e, l.id, "xy")}
                    onTouchStart={(e) => onTouchResize(e, l.id, "xy")}
                    className="absolute z-10 -right-2 -bottom-2 w-5 h-5 pointer-coarse:-right-4 pointer-coarse:-bottom-4 pointer-coarse:w-9 pointer-coarse:h-9 cursor-nwse-resize touch-none"
                    title="Drag to resize"
                  >
                    <span className="absolute right-1.5 bottom-1.5 w-2.5 h-2.5 border-r-2 border-b-2 border-accent rounded-br-sm pointer-coarse:right-2.5 pointer-coarse:bottom-2.5 pointer-coarse:w-4 pointer-coarse:h-4 pointer-coarse:rounded-full pointer-coarse:border-2 pointer-coarse:bg-surface pointer-coarse:shadow-sm" />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {drag && byId.get(drag.id) && (
        // The tile itself, lifted off the grid and following the pointer at its real size.
        <div
          className="pointer-events-none fixed left-0 top-0 z-50 opacity-95 [&>*]:h-full"
          style={{
            width: drag.w,
            height: drag.h,
            transform: `translate(${drag.x - drag.grabX}px, ${drag.y - drag.grabY}px) rotate(1deg) scale(1.02)`,
            filter: "drop-shadow(0 18px 32px rgb(0 0 0 / 0.22))",
          }}
          aria-hidden
          inert
        >
          {byId.get(drag.id)!.node}
        </div>
      )}
    </div>
  );
}

function SizeButton({
  label,
  onClick,
  disabled,
  wide,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      // Taps on a control are taps, not the start of a drag or a hold.
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={onClick}
      className={`${wide ? "px-1.5" : "w-5"} h-5 pointer-coarse:h-8 pointer-coarse:min-w-8 pointer-coarse:px-2 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-30 disabled:hover:bg-transparent`}
    >
      {children}
    </button>
  );
}
