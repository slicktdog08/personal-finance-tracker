// USD parsing/formatting. Handles "$1,100.00", "-$1,234.56", "($123.45)", "" → null.

export function parseMoney(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isNaN(raw) ? null : raw;
  let s = raw.trim();
  if (s === "") return null;
  let negative = false;
  // Accounting-style negatives: (123.45)
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (s.startsWith("+")) s = s.slice(1);
  if (s === "") return null;
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return negative ? -n : n;
}

// drizzle returns DECIMAL columns as strings; normalize to number|null.
export function toNum(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isNaN(n) ? null : n;
}

export function formatMoney(v: string | number | null | undefined): string {
  const n = toNum(v);
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
