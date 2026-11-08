import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LAYOUT,
  GRID_COLS,
  MAX_H,
  MIN_H,
  MIN_W,
  MOBILE_COLS,
  effectiveWidths,
  mobileDefaultFrom,
  moveItem,
  normalizeLayout,
  normalizeMobileLayout,
  type LayoutItem,
  type WidgetId,
} from "@/lib/dashboard-layout";

const ids = (l: LayoutItem[]) => l.map((x) => x.id);

describe("normalizeLayout", () => {
  test("nothing stored → the default layout", () => {
    assert.deepEqual(normalizeLayout(null), DEFAULT_LAYOUT);
    assert.deepEqual(normalizeLayout("garbage"), DEFAULT_LAYOUT);
  });

  test("drops unknown ids and duplicates, clamps sizes", () => {
    const out = normalizeLayout([
      { id: "net-worth", w: 99, h: 5 },
      { id: "nope", w: 4, h: null },
      { id: "net-worth", w: 3, h: null },
      { id: "cash", w: 0, h: 99999 },
    ]);
    const nw = out.find((l) => l.id === "net-worth")!;
    const cash = out.find((l) => l.id === "cash")!;
    assert.deepEqual(nw, { id: "net-worth", w: GRID_COLS, h: MIN_H });
    assert.deepEqual(cash, { id: "cash", w: MIN_W, h: MAX_H });
    assert.equal(out.length, DEFAULT_LAYOUT.length);
    assert.equal(new Set(ids(out)).size, out.length);
  });

  test("a widget missing from the stored copy lands after its default predecessor", () => {
    const stored = DEFAULT_LAYOUT.filter((l) => l.id !== "goals").reverse();
    const out = normalizeLayout(stored);
    const at = ids(out).indexOf("goals");
    const before = DEFAULT_LAYOUT[DEFAULT_LAYOUT.findIndex((l) => l.id === "goals") - 1].id;
    assert.equal(ids(out)[at - 1], before);
  });

  test("a missing first widget goes to the top", () => {
    const out = normalizeLayout(DEFAULT_LAYOUT.slice(1));
    assert.equal(out[0].id, "attention");
  });
});

describe("effectiveWidths", () => {
  const all = new Set(DEFAULT_LAYOUT.map((l) => l.id));

  test("everything present → widths exactly as stored", () => {
    const w = effectiveWidths(DEFAULT_LAYOUT, all);
    for (const l of DEFAULT_LAYOUT) assert.equal(w.get(l.id), l.w);
  });

  test("absent tiles' width goes to the rest of their row, which still sums to 12", () => {
    const present = new Set([...all].filter((id) => id !== "safe-to-spend" && id !== "payday"));
    const w = effectiveWidths(DEFAULT_LAYOUT, present);
    const row: WidgetId[] = ["cash", "credit", "loans"];
    assert.equal(row.reduce((s, id) => s + w.get(id)!, 0), 12);
    assert.ok(w.get("cash")! > 3);
    assert.equal(w.has("safe-to-spend"), false);
    // Other rows untouched.
    assert.equal(w.get("activity"), 8);
  });

  test("a row that wasn't full stays not full", () => {
    const layout: LayoutItem[] = [
      { id: "cash", w: 3, h: null },
      { id: "credit", w: 3, h: null },
      { id: "net-worth", w: 12, h: null },
    ];
    const w = effectiveWidths(layout, new Set<WidgetId>(["cash", "net-worth"]));
    assert.equal(w.get("cash"), 6);
    assert.equal(w.get("net-worth"), 12);
  });
});

describe("normalizeMobileLayout", () => {
  const desktop = normalizeLayout(null);

  test("nothing stored → the desktop order, tiles half width, the rest full", () => {
    const out = normalizeMobileLayout(null, desktop);
    assert.deepEqual(ids(out), ids(desktop));
    assert.equal(out.find((l) => l.id === "cash")!.w, 1);
    assert.equal(out.find((l) => l.id === "budget")!.w, MOBILE_COLS);
    assert.ok(out.every((l) => l.h === null));
  });

  test("follows a rearranged desktop order until it's saved on its own", () => {
    const rearranged = [...desktop].reverse();
    assert.deepEqual(ids(normalizeMobileLayout(null, rearranged)), ids(rearranged));
  });

  test("a stored phone layout keeps its own order; widths clamp to 1–2 columns", () => {
    const stored = [
      { id: "income-vs-outgoing", w: 7, h: 300 },
      { id: "cash", w: 0, h: null },
    ];
    const out = normalizeMobileLayout(stored, desktop);
    // The stored pair keeps its own (non-desktop) relative order; unsaved widgets merge around it.
    assert.ok(ids(out).indexOf("income-vs-outgoing") < ids(out).indexOf("cash"));
    assert.deepEqual(out.find((l) => l.id === "income-vs-outgoing"), { id: "income-vs-outgoing", w: MOBILE_COLS, h: 300 });
    assert.equal(out.find((l) => l.id === "cash")!.w, 1);
    assert.equal(out.length, desktop.length);
  });

  test("a widget the phone copy lacks slots in after its desktop-order predecessor", () => {
    const base = mobileDefaultFrom(desktop);
    const out = normalizeMobileLayout(base.filter((l) => l.id !== "goals"), desktop);
    const at = ids(out).indexOf("goals");
    const before = desktop[desktop.findIndex((l) => l.id === "goals") - 1].id;
    assert.equal(ids(out)[at - 1], before);
  });

  test("two columns: a half widget whose partner is absent widens to the full row", () => {
    const layout = [
      { id: "cash" as WidgetId, w: 1, h: null },
      { id: "credit" as WidgetId, w: 1, h: null },
      { id: "loans" as WidgetId, w: 1, h: null },
    ];
    const w = effectiveWidths(layout, new Set<WidgetId>(["cash", "loans"]), MOBILE_COLS);
    assert.equal(w.get("cash"), 2);
    assert.equal(w.get("loans"), 1);
  });
});

describe("moveItem", () => {
  const l: LayoutItem[] = (["cash", "credit", "loans"] as WidgetId[]).map((id) => ({ id, w: 4, h: null }));

  test("before / after a target", () => {
    assert.deepEqual(ids(moveItem(l, "loans", "cash", false)), ["loans", "cash", "credit"]);
    assert.deepEqual(ids(moveItem(l, "cash", "loans", true)), ["credit", "loans", "cash"]);
  });

  test("no-op moves return the same array", () => {
    assert.equal(moveItem(l, "cash", "cash", true), l);
    assert.equal(moveItem(l, "cash", "credit", false), l);
  });
});
