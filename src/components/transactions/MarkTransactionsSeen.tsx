"use client";

import { useEffect } from "react";
import { markTransactionsSeen } from "@/server/actions/transactions-seen";
import { TXN_SEEN_EVENT } from "@/lib/transactions-seen";

/**
 * Renders nothing. Once the Transactions page is actually on screen, records that the user has
 * seen everything up to `upToId` and tells the app shell to clear its "new" badge. Done after
 * mount rather than during the server render so a link prefetch never counts as a visit.
 */
export function MarkTransactionsSeen({ upToId }: { upToId: number }) {
  useEffect(() => {
    if (!upToId) return;
    let cancelled = false;
    markTransactionsSeen(upToId).then((r) => {
      if (r.ok && !cancelled) window.dispatchEvent(new CustomEvent(TXN_SEEN_EVENT));
    });
    return () => {
      cancelled = true;
    };
  }, [upToId]);
  return null;
}
