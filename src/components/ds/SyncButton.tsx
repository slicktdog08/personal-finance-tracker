"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncNow } from "@/server/actions/sync";
import { Icon } from "./Icon";

/**
 * Runs a bank sync now (the same server action as Settings → Bank sync), spins while it runs, then
 * refreshes so the page, badges and "Synced …" line pick up what arrived. A failure (e.g. a run
 * already in progress) shows as the button's tooltip and a polite announcement, not an alert.
 *
 * `nav` renders it as a sidebar nav item (icon + status label, icon-only when the sidebar is collapsed).
 */
export function SyncButton({ className = "", variant = "icon", navLabel }: { className?: string; variant?: "icon" | "nav"; navLabel?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label = pending ? "Syncing…" : error ? `Sync failed: ${error}` : "Sync now";
  const nav = variant === "nav";
  return (
    <button
      type="button"
      className={nav ? `mp-navitem ${className}` : `mp-btn mp-iconbtn mp-btn--ghost ${error ? "text-danger" : ""} ${className}`}
      aria-label={label}
      title={label}
      disabled={pending}
      onClick={() =>
        start(async () => {
          setError(null);
          const r = await syncNow();
          if (!r.ok) {
            setError(r.error);
            router.refresh();
          }
        })
      }
    >
      <Icon name="refresh-cw" size={18} className={pending ? "mp-spinner" : undefined} />
      {/* Sidebar row: reads as the sync status ("Synced 4h ago") and runs a sync when clicked. */}
      {nav && (
        <span className={"mp-navitem__label" + (error ? " text-danger" : "")} aria-hidden="true">
          {pending ? "Syncing…" : error ? "Sync failed" : (navLabel ?? "Sync now")}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {pending ? "Syncing" : error ? `Sync failed: ${error}` : ""}
      </span>
    </button>
  );
}
