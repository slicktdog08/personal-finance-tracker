// "Demo Bank": a deterministic, made-up bank feed. Pure — no database, no network, no clock
// unless a caller passes one. Two things read it and must agree, which is why it lives apart
// from both:
//
//   • seed.ts writes the feed's history into the ledger (everyday card-swipe spending), and
//   • provider.ts serves the same feed to the sync engine, so "Sync now" in the demo brings in
//     exactly the rows the seed has not written yet, under stable external ids.
//
// Every value is fictional. A day's rows depend only on (account kind, date).

export const DEMO_PROVIDER_ID = "demo";
export const DEMO_INSTITUTION = "Demo Bank";
export const DEMO_ENROLLMENT_ID = "demo-bank";

export type DemoAccountKind = "checking" | "card";

export const DEMO_ACCOUNTS: Record<DemoAccountKind, { externalId: string; lastFour: string; name: string; creditLimit: number | null }> = {
  checking: { externalId: "demo-chk-1111", lastFour: "1111", name: "Everyday Checking", creditLimit: null },
  card: { externalId: "demo-card-3333", lastFour: "3333", name: "Card A", creditLimit: 6000 },
};

export function kindOfExternalId(externalId: string): DemoAccountKind | null {
  if (externalId === DEMO_ACCOUNTS.checking.externalId) return "checking";
  if (externalId === DEMO_ACCOUNTS.card.externalId) return "card";
  return null;
}

// ---- deterministic randomness ---------------------------------------------------------------

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 seeded from a string: the same seed always yields the same sequence. */
export function rngFor(seed: string): () => number {
  let a = hashString(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const between = (r: () => number, lo: number, hi: number) => round2(lo + r() * (hi - lo));
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

// ---- dates (ISO strings, parsed by parts — never `new Date(iso)`) ----------------------------

const DAY_MS = 86_400_000;
export function isoToMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
export function msToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
export function addDays(iso: string, n: number): string {
  return msToIso(isoToMs(iso) + n * DAY_MS);
}
export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let ms = isoToMs(start); ms <= isoToMs(end); ms += DAY_MS) out.push(msToIso(ms));
  return out;
}

// ---- the feed --------------------------------------------------------------------------------

export interface DemoFeedItem {
  /** Stable per (kind, date): `demo-<kind>-<yyyymmdd>-<n>`. */
  externalId: string;
  kind: DemoAccountKind;
  date: string;
  /** Hour of day the charge "happened" — a sync only sees today's rows up to the current hour. */
  hour: number;
  description: string;
  amount: number;
  direction: "Debit" | "Credit";
  counterparty: string;
}

const GROCERS = ["ANYTOWN MARKET #102", "FRESH FOODS CO-OP ANYTOWN CA"] as const;
const DINERS = ["TACO STOP ANYTOWN CA", "NOODLE HOUSE", "PIZZA PLACE #7", "CORNER DINER"] as const;
const SHOPS = ["ONLINE MARKETPLACE ORDER", "BOOK NOOK ANYTOWN", "OUTDOOR OUTFITTERS", "HOME GOODS WAREHOUSE"] as const;

/** One day of card-swipe activity on a demo account. Deterministic; may be empty for the card. */
export function demoFeed(kind: DemoAccountKind, date: string): DemoFeedItem[] {
  const r = rngFor(`${kind}|${date}`);
  const rows: Omit<DemoFeedItem, "externalId" | "kind" | "date">[] = [];
  const add = (hour: number, description: string, amount: number, counterparty: string) =>
    rows.push({ hour, description, amount, direction: "Debit", counterparty });

  if (kind === "checking") {
    // The daily coffee: always there, early, so a sync always has something new to show.
    add(0, "SUNRISE COFFEE ANYTOWN CA", between(r, 4.25, 6.75), "Sunrise Coffee");
    if (r() < 0.2) add(17, pick(r, GROCERS), between(r, 38, 105), "Groceries");
    if (r() < 0.14) add(8, "CORNER GAS & GO #14", between(r, 31, 56), "Corner Gas & Go");
    if (r() < 0.15) add(19, pick(r, DINERS), between(r, 11, 46), "Restaurant");
    if (r() < 0.05) add(13, "CITY PHARMACY #220", between(r, 8, 42), "City Pharmacy");
    if (r() < 0.035) add(11, "HARDWARE DEPOT ANYTOWN", between(r, 12, 68), "Hardware Depot");
    if (r() < 0.03) add(15, "PAYMENT APP *J SMITH", between(r, 15, 45), "Payment App");
  } else {
    if (r() < 0.07) add(12, pick(r, SHOPS), between(r, 22, 128), "Shopping");
    if (r() < 0.06) add(22, "RIDESHARE TRIP", between(r, 9, 31), "Rideshare");
    if (r() < 0.05) add(20, pick(r, DINERS), between(r, 18, 62), "Restaurant");
    if (r() < 0.03) add(10, "SQ *FARMERS MKT STALL 9", between(r, 8, 27), "Farmers Market");
  }
  const ymd = date.replace(/-/g, "");
  return rows.map((row, i) => ({ ...row, kind, date, externalId: `demo-${kind}-${ymd}-${i + 1}` }));
}

/** A row is still a pending hold on the day it happens and the day after. */
export function demoIsPending(date: string, today: string): boolean {
  return date >= addDays(today, -1);
}

// ---- the "access token" ----------------------------------------------------------------------
// There is no bank to authenticate with, so the token just carries what a stateless provider
// needs to report balances that agree with the seeded ledger: each account's ledger balance on
// the seed day (holds from the day before not yet included).

export interface DemoTokenState {
  seedDay: string;
  /** Checking: money in the account. Card: amount owed. */
  ledger: Record<DemoAccountKind, number>;
}

const TOKEN_PREFIX = "demo:";

export function encodeDemoToken(state: DemoTokenState): string {
  return TOKEN_PREFIX + Buffer.from(JSON.stringify(state), "utf8").toString("base64");
}

export function decodeDemoToken(token: string): DemoTokenState | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  try {
    const s = JSON.parse(Buffer.from(token.slice(TOKEN_PREFIX.length), "base64").toString("utf8")) as DemoTokenState;
    if (typeof s.seedDay !== "string" || typeof s.ledger?.checking !== "number" || typeof s.ledger?.card !== "number") return null;
    return s;
  } catch {
    return null;
  }
}

/** Ledger and pending totals for an account "now", derived from the seed-day balance + the feed. */
export function demoBalances(state: DemoTokenState, kind: DemoAccountKind, today: string, hour: number): { ledger: number; pending: number } {
  let ledger = state.ledger[kind];
  let pending = 0;
  // Rows from the day before the seed onward were holds (or not yet written) when the token was
  // minted; each joins the ledger once it is no longer pending.
  for (const day of eachDay(addDays(state.seedDay, -1), today)) {
    for (const item of demoFeed(kind, day)) {
      if (day === today && item.hour > hour) continue;
      const signed = kind === "checking" ? -item.amount : item.amount;
      if (demoIsPending(day, today)) pending += item.amount;
      else ledger += signed;
    }
  }
  return { ledger: round2(ledger), pending: round2(pending) };
}
