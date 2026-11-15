import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { holdRow, mergeHeldRows, type HeldRow } from "@/lib/held-rows";

interface Row {
  id: number;
  category: string | null;
}
const row = (id: number, category: string | null = null): Row => ({ id, category });
const ids = (rows: Row[]) => rows.map((r) => r.id);

describe("held rows (a categorized row stays in the Uncategorized list)", () => {
  const page = [row(1), row(2), row(3), row(4)];

  test("a row the refreshed list dropped is put back where it was, with its new category", () => {
    const held = holdRow(new Map<number, HeldRow<Row>>(), page, 2, { category: "Dining" })!;
    // The server now returns the list without #2, topped up with the next row.
    const { rows, keptIds } = mergeHeldRows([row(1), row(3), row(4), row(5)], held);
    assert.deepEqual(ids(rows), [1, 2, 3, 4, 5]);
    assert.equal(rows[1].category, "Dining");
    assert.deepEqual([...keptIds], [2]);
  });

  test("several held rows each return to their own place", () => {
    let held = holdRow(new Map<number, HeldRow<Row>>(), page, 1, { category: "A" })!;
    held = holdRow(held, mergeHeldRows([row(2), row(3), row(4)], held).rows, 3, { category: "B" })!;
    held = holdRow(held, mergeHeldRows([row(2), row(4)], held).rows, 4, { category: "C" })!;
    assert.deepEqual(ids(mergeHeldRows([], held).rows), [1, 3, 4]);
    assert.deepEqual(ids(mergeHeldRows([row(2), row(5)], held).rows), [1, 2, 3, 4, 5]);
  });

  test("a held row the server still returns uses the server's copy and isn't marked", () => {
    const held = holdRow(new Map<number, HeldRow<Row>>(), page, 2, { category: "Dining" })!;
    const server = [row(1), row(2, "Dining"), row(3)];
    const { rows, keptIds } = mergeHeldRows(server, held);
    assert.equal(rows, server);
    assert.equal(keptIds.size, 0);
  });

  test("re-categorizing a held row keeps its original position", () => {
    let held = holdRow(new Map<number, HeldRow<Row>>(), page, 3, { category: "A" })!;
    const shown = mergeHeldRows([row(4)], held).rows; // the list shrank: #3 now sits at index 1
    held = holdRow(held, shown, 3, { category: "B" })!;
    assert.equal(held.get(3)!.at, 2);
    assert.equal(held.get(3)!.row.category, "B");
  });

  test("nothing held, or an unknown id, changes nothing", () => {
    assert.equal(mergeHeldRows(page, new Map()).rows, page);
    assert.equal(holdRow(new Map<number, HeldRow<Row>>(), page, 99, { category: "X" }), null);
  });
});
