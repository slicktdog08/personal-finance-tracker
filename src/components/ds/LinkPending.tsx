"use client";

import { useLinkStatus } from "next/link";

/**
 * Zero-size marker to drop inside a <Link>. It carries data-pending while that link's navigation
 * is in flight, and motion.css styles the enclosing nav item from it (:has), so the thing you
 * tapped reacts immediately even when the route hasn't committed yet.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return <span className="mp-linkpending" data-pending={pending || undefined} aria-hidden="true" />;
}
