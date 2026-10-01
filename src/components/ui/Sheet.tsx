"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useIsDesktop } from "./useMediaQuery";
import { usePopoverPosition } from "./usePopoverPosition";
import { useExitTransition } from "./useExitTransition";

// The one modal primitive. Below md it's a bottom sheet (backdrop, rounded top,
// internal scroll, safe-area padding). At md+ it's either a popover anchored to
// `anchorRef` (no backdrop — matches the app's existing panel feel) or a
// centered dialog.
//
// Nested-portal rule: menus that portal to <body> (ColorSelect, EmojiPicker,
// MultiSelect) must carry data-popover-root so an anchored Sheet's outside-click
// doesn't treat clicks inside them as "outside". The backdrop only closes on
// clicks that land on the backdrop element itself for the same reason.
export function Sheet({
  open,
  onClose,
  title,
  children,
  anchorRef,
  desktop = "centered",
  width = 320,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  anchorRef?: RefObject<HTMLElement | null>;
  desktop?: "anchored" | "centered";
  width?: number;
  footer?: ReactNode;
}) {
  const isDesktop = useIsDesktop();
  const panelRef = useRef<HTMLDivElement>(null);
  const nullAnchor = useRef<HTMLElement | null>(null);
  const anchored = desktop === "anchored" && !!anchorRef;
  const pos = usePopoverPosition(anchorRef ?? nullAnchor, {
    width,
    open: open && isDesktop && anchored,
    align: "right",
  });
  const hasBackdrop = !isDesktop || !anchored;
  // Stay mounted briefly after close so the exit animation can play.
  const { mounted, closing } = useExitTransition(open, 250);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Anchored popovers have no backdrop, so close on any pointerdown that isn't
  // in the anchor (its own onClick toggles), the panel, or a nested portal menu.
  useEffect(() => {
    if (!(open && isDesktop && anchored)) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (anchorRef?.current?.contains(t)) return;
      if (t.closest?.("[data-popover-root]")) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open, isDesktop, anchored, anchorRef, onClose]);

  useEffect(() => {
    if (!(open && hasBackdrop)) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open, hasBackdrop]);

  // Focus the panel on open (not the first input — that would pop the mobile
  // keyboard; forms opt in via autoFocus) and restore focus on close.
  useEffect(() => {
    if (!open) return;
    const prevActive = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      cancelAnimationFrame(id);
      prevActive?.focus?.();
    };
  }, [open]);

  if (!mounted) return null;

  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const els = panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const surface = "bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100";

  const header = (
    <div className="flex items-center justify-between gap-2 mb-2">
      <h2 className="font-semibold">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="h-11 w-11 -mr-2 -my-2 flex items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        ✕
      </button>
    </div>
  );

  if (isDesktop && anchored) {
    // Anchored popovers close instantly on purpose — matches the desktop feel.
    if (!open || !pos) return null;
    return createPortal(
      <div
        ref={panelRef}
        data-popover-root=""
        tabIndex={-1}
        role="dialog"
        aria-label={title}
        onKeyDown={trapTab}
        style={{ position: "fixed", left: pos.left, top: pos.top, width, maxHeight: pos.maxHeight }}
        className={`z-50 rounded-lg border border-neutral-300 dark:border-neutral-700 ${surface} shadow-xl p-3 overflow-y-auto outline-none`}
      >
        {header}
        {children}
        {footer}
      </div>,
      document.body,
    );
  }

  const panelCls = isDesktop
    ? `fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md rounded-lg border border-neutral-300 dark:border-neutral-700 ${surface} shadow-xl max-h-[85vh] overflow-y-auto p-4 outline-none ${
        closing
          ? "motion-safe:animate-[dialog-out_.2s_ease-in_forwards]"
          : "motion-safe:animate-[dialog-in_.2s_ease-out]"
      }`
    : `fixed inset-x-0 bottom-0 z-50 rounded-t-2xl ${surface} shadow-xl max-h-[85dvh] overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] outline-none ${
        closing
          ? "motion-safe:animate-[sheet-down_.25s_ease-in_forwards]"
          : "motion-safe:animate-[sheet-up_.3s_cubic-bezier(0.16,1,0.3,1)]"
      }`;

  return createPortal(
    <div data-popover-root="" className={closing ? "pointer-events-none" : undefined}>
      <div
        className={`fixed inset-0 z-40 bg-black/40 ${
          closing
            ? "motion-safe:animate-[overlay-fade-out_.25s_ease-in_forwards]"
            : "motion-safe:animate-[overlay-fade_.2s_ease-out]"
        }`}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={trapTab}
        className={panelCls}
      >
        {!isDesktop && (
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700" />
        )}
        {header}
        {children}
        {footer}
      </div>
    </div>,
    document.body,
  );
}
