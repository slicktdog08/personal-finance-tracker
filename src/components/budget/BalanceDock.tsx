"use client";

import { Button } from "@/components/ds";

/**
 * The one line of guidance, floating at the bottom while any envelope is open: who's open and
 * where the next change lands. Disappears when everything is locked. Sits above the mobile tab bar
 * (and the safe area) on phones, and below the Sheet layer.
 */
export function BalanceDock({ message, detail, onLockAll }: { message: string; detail?: string | null; onLockAll: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--mp-tabbar-h)+env(safe-area-inset-bottom))] lg:bottom-0 z-30 flex justify-center px-4 pb-4 lg:pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto flex max-w-2xl min-w-0 items-center gap-4 rounded-panel border border-line bg-raised px-4 py-3 shadow-overlay motion-safe:animate-[rise_.2s_ease-out]">
        <div className="min-w-0">
          <div className="text-sm font-medium text-fg truncate">{message}</div>
          {detail && <div className="text-xs text-fg-3 tabular-nums truncate">{detail}</div>}
        </div>
        <Button size="sm" icon="check" onClick={onLockAll} className="shrink-0">
          Done
        </Button>
      </div>
    </div>
  );
}
