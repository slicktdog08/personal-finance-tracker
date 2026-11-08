// Shared by the server layout and client components (kept out of "use client" files so the
// server gets the function itself, not a client reference).

/** "4h ago" for the shell's last-sync line. */
export function syncedAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "Never synced";
  const mins = Math.max(0, (now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "Synced just now";
  if (mins < 60) return `Synced ${Math.floor(mins)}m ago`;
  if (mins < 48 * 60) return `Synced ${Math.floor(mins / 60)}h ago`;
  return `Synced ${Math.floor(mins / 1440)}d ago`;
}
