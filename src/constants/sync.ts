// Bank-sync constants safe to import from client components (no server deps).

export const SYNC_INTERVAL_CHOICES = [60, 120, 180, 240, 360, 720, 1440] as const;

export const TXN_STATUSES = ["posted", "pending"] as const;
export type TxnStatus = (typeof TXN_STATUSES)[number];

// transactions.source values. A registered provider id is also valid (bank-synced rows).
export const TXN_SOURCES = ["import", "pdf", "manual"] as const;
export const LOCAL_SOURCES: readonly string[] = TXN_SOURCES;

export const SOURCE_LABELS: Record<string, string> = {
  import: "CSV import",
  pdf: "PDF statement",
  manual: "Entered by hand",
};

export function sourceLabel(source: string | null | undefined): string {
  if (!source) return "";
  return SOURCE_LABELS[source] ?? `Bank sync (${source})`;
}
