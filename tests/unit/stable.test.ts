import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isEqualDeep, replaceEqualDeep } from "@/lib/stable";
import { applyRowEdit, makeBillFacts, rowPatch, type SheetRow } from "@/components/bills/billFacts";

const row = (id: number, over: Partial<SheetRow> = {}): SheetRow => ({
  id,
  billId: null,
  name: `Bill ${id}`,
  amount: "10.00",
  status: "Not Paid",
  dueDay: 5,
  paymentType: null,
  isDebt: false,
  isCancel: false,
  ...over,
});

describe("replaceEqualDeep", () => {
  test("returns the previous value itself when the new one is deep-equal", () => {
    const prev = [row(1), row(2)];
    const next = [row(1), row(2)];
    assert.equal(replaceEqualDeep(prev, next), prev);
  });

  test("keeps unchanged rows' identity and replaces only the changed one", () => {
    const prev = [row(1), row(2), row(3)];
    const next = [row(1), row(2, { status: "Paid/Purchased" }), row(3)];
    const out = replaceEqualDeep(prev, next);
    assert.notEqual(out, prev);
    assert.equal(out[0], prev[0]);
    assert.equal(out[2], prev[2]);
    assert.notEqual(out[1], prev[1]);
    assert.deepEqual(out, next);
  });

  test("matches rows by id, so an insert or a removal doesn't disturb the rest", () => {
    const prev = [row(1), row(2), row(3)];
    const inserted = replaceEqualDeep(prev, [row(9), row(1), row(2), row(3)]);
    assert.deepEqual(inserted.slice(1).map((r, i) => r === prev[i]), [true, true, true]);
    const removed = replaceEqualDeep(prev, [row(1), row(3)]);
    assert.equal(removed[0], prev[0]);
    assert.equal(removed[1], prev[2]);
  });

  test("a reorder of equal rows is a new array of the same objects", () => {
    const prev = [row(1), row(2)];
    const out = replaceEqualDeep(prev, [row(2), row(1)]);
    assert.notEqual(out, prev);
    assert.equal(out[0], prev[1]);
    assert.equal(out[1], prev[0]);
  });

  test("falls back to position when ids are missing or repeated", () => {
    const prev = [{ id: 1, v: "a" }, { id: 1, v: "b" }];
    const out = replaceEqualDeep(prev, [{ id: 1, v: "a" }, { id: 1, v: "c" }]);
    assert.equal(out[0], prev[0]);
    assert.deepEqual(out[1], { id: 1, v: "c" });
    const plain = ["a", "b"];
    assert.equal(replaceEqualDeep(plain, ["a", "b"]), plain);
  });

  test("shares nested structures and notices added, removed and undefined keys", () => {
    const prev = { a: { x: 1 }, list: [{ id: 1, tags: ["t"] }], n: null as null | number };
    const same = replaceEqualDeep(prev, { a: { x: 1 }, list: [{ id: 1, tags: ["t"] }], n: null });
    assert.equal(same, prev);
    const changed = replaceEqualDeep(prev, { a: { x: 1 }, list: [{ id: 1, tags: ["u"] }], n: null });
    assert.equal(changed.a, prev.a);
    assert.notEqual(changed.list, prev.list);
    assert.equal(isEqualDeep({ a: 1 }, { a: 1, b: undefined }), false);
    assert.equal(isEqualDeep({ a: 1, b: undefined }, { a: 1 }), false);
    assert.equal(isEqualDeep({ a: undefined }, { b: undefined }), false);
  });

  test("compares functions, class instances and React elements by reference", () => {
    const fn = () => 1;
    assert.equal(isEqualDeep({ fn }, { fn }), true);
    assert.equal(isEqualDeep({ fn }, { fn: () => 1 }), false);
    assert.equal(isEqualDeep({ d: new Date(0) }, { d: new Date(0) }), false);
    const el = { $$typeof: Symbol.for("react.transitional.element"), type: "div", props: {} };
    assert.equal(isEqualDeep({ el }, { el: { ...el } }), false);
    assert.equal(isEqualDeep({ el }, { el }), true);
  });

  test("primitives, null and type changes", () => {
    assert.equal(isEqualDeep(1, 1), true);
    assert.equal(isEqualDeep(NaN, NaN), true);
    assert.equal(isEqualDeep(null, {}), false);
    assert.equal(isEqualDeep([], {}), false);
    assert.equal(isEqualDeep("1", 1), false);
  });
});

describe("bill row edits", () => {
  test("applyRowEdit touches only the edited rows", () => {
    const rows = [row(1), row(2), row(3)];
    const out = applyRowEdit(rows, { ids: [2], patch: { status: "Pending" } });
    assert.equal(out[0], rows[0]);
    assert.equal(out[2], rows[2]);
    assert.equal(out[1].status, "Pending");
    assert.equal(rows[1].status, "Not Paid");
    assert.deepEqual(applyRowEdit(rows, { remove: 2 }).map((r) => r.id), [1, 3]);
  });

  test("rowPatch mirrors what the server stores", () => {
    assert.deepEqual(rowPatch({ amount: 12.5 }), { amount: "12.5" });
    assert.deepEqual(rowPatch({ amount: null }), { amount: null });
    assert.deepEqual(rowPatch({ paymentType: "" }), { paymentType: null });
    assert.deepEqual(rowPatch({ status: "Paid/Purchased", sortOrder: 3 }), { status: "Paid/Purchased" });
    assert.deepEqual(rowPatch({}), {});
  });

  test("makeBillFacts: settled, past due and due-date groups", () => {
    const statuses = [
      { id: 1, name: "Paid/Purchased", color: "#0a0", emoji: null, isSettled: true },
      { id: 2, name: "Not Paid", color: "#888", emoji: null, isSettled: false },
      { id: 3, name: "Autopay Pending", color: "#fa0", emoji: null, isSettled: false },
      { id: 4, name: "Past Due", color: "#f00", emoji: null, isSettled: false },
    ];
    const f = makeBillFacts({ statuses, year: 2026, month: 11, today: "2026-11-05" });
    assert.equal(f.paidStatus, "Paid/Purchased");
    assert.equal(f.mon, "Nov");
    assert.equal(f.groupOf(row(1, { status: "Paid/Purchased", dueDay: 1 })), "Settled");
    assert.equal(f.groupOf(row(2, { dueDay: 3 })), "Overdue");
    assert.equal(f.isPastDue(row(3, { status: "Autopay Pending", dueDay: 3 })), false);
    assert.equal(f.isPastDue(row(4, { status: "Past Due", dueDay: 20 })), true);
    assert.equal(f.groupOf(row(5, { dueDay: 8 })), "This week");
    assert.equal(f.groupOf(row(6, { dueDay: 25 })), "Later this month");
    assert.equal(f.groupOf(row(7, { dueDay: null })), "No due date");
    // Day 31 in a 30-day month is due on the 30th.
    assert.equal(makeBillFacts({ statuses, year: 2026, month: 11, today: "2026-11-30" }).isPastDue(row(8, { dueDay: 31 })), false);
    assert.equal(makeBillFacts({ statuses, year: 2026, month: 10, today: "2026-11-05" }).groupOf(row(9, { dueDay: 25 })), "Overdue");
  });
});
