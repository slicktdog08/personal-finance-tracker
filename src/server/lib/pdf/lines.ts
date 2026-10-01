// Pure (no DB / no pdfjs) helpers for turning positioned PDF text fragments into
// visual lines. pdf.js emits each run of text as an item with an (x, y) transform;
// a table row shares one baseline y, so grouping by y and ordering by x reconstructs
// the row exactly as a human reads it. Kept dependency-free so it's trivially testable.

export interface PositionedItem {
  str: string;
  x: number;
  y: number;
}

// Group items into lines: items whose baseline y is within `yTolerance` belong to the
// same visual line. Lines come back top-to-bottom; within a line, left-to-right.
export function groupItemsToLines(items: PositionedItem[], yTolerance = 3): string[] {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const buckets: { y: number; items: PositionedItem[] }[] = [];
  for (const it of sorted) {
    const last = buckets[buckets.length - 1];
    if (last && Math.abs(last.y - it.y) <= yTolerance) {
      last.items.push(it);
    } else {
      buckets.push({ y: it.y, items: [it] });
    }
  }
  return buckets
    .map((b) =>
      b.items
        .sort((a, c) => a.x - c.x)
        .map((i) => i.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((s) => s !== "");
}
