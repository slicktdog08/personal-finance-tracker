"use client";

import { useState } from "react";
import { IconButton } from "@/components/ds";
import { SYNC_NOTICE_COOKIE } from "@/lib/sync-notice";

/**
 * Wraps the server-rendered sync notice with an ✕. Dismissing remembers WHICH problem was waved
 * off (`dismissKey`: the failed run, or the set of disconnected banks) in a cookie the server reads,
 * so the notice stays gone across reloads without a flash — and comes back on its own when a new
 * failure or a different disconnection happens.
 */
export function SyncNoticeDismiss({ dismissKey, children }: { dismissKey: string; children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className="relative">
      {children}
      <IconButton
        icon="x"
        label="Dismiss"
        size="sm"
        className="absolute right-1.5 top-1.5"
        onClick={() => {
          document.cookie = `${SYNC_NOTICE_COOKIE}=${encodeURIComponent(dismissKey)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
          setHidden(true);
        }}
      />
    </div>
  );
}
