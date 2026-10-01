"use client";

/**
 * The one line of guidance, floating at the bottom while any envelope is open: who's open and
 * where the next change lands. Disappears when everything is locked. Sits above the safe area
 * on phones and below the Sheet layer.
 */
export function BalanceDock({ message, detail, onLockAll }: { message: string; detail?: string | null; onLockAll: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto flex max-w-2xl items-center gap-4 rounded-2xl border border-neutral-200/80 dark:border-neutral-700 bg-white/90 dark:bg-neutral-900/90 backdrop-blur px-4 py-3 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.35)] motion-safe:animate-[rise_.2s_ease-out]">
        <div className="min-w-0">
          <div className="text-sm">{message}</div>
          {detail && <div className="text-xs text-neutral-500 tabular-nums truncate">{detail}</div>}
        </div>
        <button type="button" onClick={onLockAll} className="shrink-0 rounded-full bg-neutral-900 dark:bg-white px-3.5 py-1.5 text-xs font-medium text-white dark:text-neutral-900 hover:opacity-90">
          Done
        </button>
      </div>
    </div>
  );
}
