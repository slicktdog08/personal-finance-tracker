// Structural sharing for data that arrives from the server.
//
// Every server render hands client components brand-new objects, even when nothing in them
// changed, so reference checks (memo, useMemo deps) see a change everywhere and every row of
// every table re-renders after any save. replaceEqualDeep walks the new value against the one
// before it and keeps the old reference wherever the content is the same: an unchanged row stays
// the very same object, and only what really changed gets a new identity.

type Plain = Record<string, unknown>;

/** Object literals only. React elements are plain objects too, but they are compared by reference. */
function isPlain(v: unknown): v is Plain {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return (proto === Object.prototype || proto === null) && !("$$typeof" in v);
}

const idOf = (v: unknown): string | number | undefined => {
  if (!isPlain(v)) return undefined;
  const id = v.id;
  return typeof id === "string" || typeof id === "number" ? id : undefined;
};

/**
 * Rows are matched by `id` when every item on both sides has a distinct one, so adding or removing a row
 * doesn't shift every row after it onto a different partner. Otherwise by position.
 */
function shareArray(prev: unknown[], next: unknown[]): unknown[] {
  let byId: Map<string | number, unknown> | null = new Map();
  for (const item of prev) {
    const id = idOf(item);
    if (id === undefined || byId.has(id)) {
      byId = null;
      break;
    }
    byId.set(id, item);
  }
  if (byId && !next.every((item) => idOf(item) !== undefined)) byId = null;

  let same = prev.length === next.length;
  const out = next.map((item, i) => {
    const shared = replaceEqualDeep(byId ? byId.get(idOf(item)!) : prev[i], item);
    if (shared !== prev[i]) same = false;
    return shared;
  });
  return same ? prev : out;
}

function shareObject(prev: Plain, next: Plain): Plain {
  const keys = Object.keys(next);
  let same = Object.keys(prev).length === keys.length;
  const out: Plain = {};
  for (const k of keys) {
    out[k] = replaceEqualDeep(prev[k], next[k]);
    if (out[k] !== prev[k] || !(k in prev)) same = false;
  }
  return same ? prev : out;
}

/** `next`, reusing every part of `prev` that is deep-equal to it. Returns `prev` itself when nothing changed. */
export function replaceEqualDeep<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next;
  if (Array.isArray(prev) && Array.isArray(next)) return shareArray(prev, next) as T;
  if (isPlain(prev) && isPlain(next)) return shareObject(prev, next) as T;
  return next;
}

/** Deep equality over plain data (arrays, object literals, primitives); anything else by reference. */
export function isEqualDeep(a: unknown, b: unknown): boolean {
  return Object.is(replaceEqualDeep(a, b), a);
}
