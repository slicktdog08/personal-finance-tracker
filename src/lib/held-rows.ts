// Keeping just-edited rows in a filtered list.
//
// Setting a transaction's category refreshes the list it sits in. Under a filter the row no
// longer fits — "Uncategorized", or the category it just left — the refreshed list comes back
// without it, and the row vanishes before anything more can be done with it (like saving the
// rule it just offered). These helpers let the list hold such rows where they were.

export interface HeldRow<T> {
  row: T;
  /** Index the row had in the list when it was first held. */
  at: number;
}

/**
 * The server's rows with every held row it no longer returns put back at its old index.
 * A held row the server still returns is left to the server's (fresher) copy.
 */
export function mergeHeldRows<T extends { id: number }>(
  serverRows: T[],
  held: ReadonlyMap<number, HeldRow<T>>,
): { rows: T[]; keptIds: Set<number> } {
  const keptIds = new Set<number>();
  if (!held.size) return { rows: serverRows, keptIds };
  const have = new Set(serverRows.map((r) => r.id));
  const missing = [...held.values()].filter((h) => !have.has(h.row.id)).sort((a, b) => a.at - b.at);
  if (!missing.length) return { rows: serverRows, keptIds };
  const rows = [...serverRows];
  // Ascending by old index, so each insert lands where it was once the ones before it are back.
  for (const h of missing) {
    rows.splice(Math.min(h.at, rows.length), 0, h.row);
    keptIds.add(h.row.id);
  }
  return { rows, keptIds };
}

/** Hold `row` (as it now looks). A row already held keeps its original index. */
export function holdRow<T extends { id: number }>(
  held: ReadonlyMap<number, HeldRow<T>>,
  list: T[],
  id: number,
  change: Partial<T>,
): Map<number, HeldRow<T>> | null {
  const at = list.findIndex((r) => r.id === id);
  if (at < 0) return null;
  return new Map(held).set(id, { row: { ...list[at], ...change }, at: held.get(id)?.at ?? at });
}
