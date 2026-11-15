// Pure arithmetic behind the dashboard's "Vital signs" and "This year" widgets. Both read the
// month-by-month cash flow the dashboard already loads (money in / out, transfers excluded), so
// they cost no query of their own. No DB access here, so the rules are unit-testable.

export interface FlowPoint {
  label: string; // "2026-03"
  income: number;
  outgoing: number;
}

export interface Vitals {
  /** The complete months the averages are taken over, oldest first. Empty = no history yet. */
  basis: string[];
  avgIncome: number | null;
  avgOutgoing: number | null;
  /** Months of spending the cash on hand covers at the average outgoing; null without a basis. */
  runwayMonths: number | null;
  /** (in − out) / in over the basis months, as a percentage; null when nothing came in. */
  savingsRate: number | null;
  /** Average kept per month over the basis (negative = spending more than comes in). */
  avgKept: number | null;
}

/**
 * Runway and savings rate as of `asOfLabel`, averaged over the last `months` months BEFORE it
 * that recorded any money moving. The month being viewed is left out on purpose: a month in
 * progress has its rent paid and only half its paychecks in, and would swing both figures daily.
 */
export function computeVitals(flows: FlowPoint[], asOfLabel: string, cash: number | null, months = 3): Vitals {
  const basis = flows
    .filter((f) => f.label < asOfLabel && (f.income > 0 || f.outgoing > 0))
    .sort((a, b) => (a.label < b.label ? -1 : 1))
    .slice(-months);
  if (!basis.length) return { basis: [], avgIncome: null, avgOutgoing: null, runwayMonths: null, savingsRate: null, avgKept: null };
  const income = basis.reduce((t, f) => t + f.income, 0);
  const outgoing = basis.reduce((t, f) => t + f.outgoing, 0);
  const avgOutgoing = outgoing / basis.length;
  return {
    basis: basis.map((f) => f.label),
    avgIncome: round2(income / basis.length),
    avgOutgoing: round2(avgOutgoing),
    runwayMonths: cash != null && avgOutgoing > 0 ? Math.max(0, cash) / avgOutgoing : null,
    savingsRate: income > 0 ? ((income - outgoing) / income) * 100 : null,
    avgKept: round2((income - outgoing) / basis.length),
  };
}

export interface YearSide {
  income: number;
  outgoing: number;
  net: number;
}

export interface YearToDate {
  year: number;
  /** Months of `year` counted, January through the month viewed. */
  months: number;
  now: YearSide;
  /** The same months a year earlier; null when that year recorded nothing in them. */
  prior: YearSide | null;
}

/**
 * January through the viewed month, beside the same span of the year before — like for like, so
 * a year in progress is never measured against a whole one.
 */
export function yearToDate(flows: FlowPoint[], asOfLabel: string): YearToDate | null {
  const m = /^(\d{4})-(\d{2})$/.exec(asOfLabel);
  if (!m) return null;
  const year = Number(m[1]);
  const through = m[2];
  const side = (y: number): YearSide & { n: number } => {
    const rows = flows.filter((f) => f.label >= `${y}-01` && f.label <= `${y}-${through}`);
    const income = rows.reduce((t, f) => t + f.income, 0);
    const outgoing = rows.reduce((t, f) => t + f.outgoing, 0);
    return { income: round2(income), outgoing: round2(outgoing), net: round2(income - outgoing), n: rows.filter((f) => f.income > 0 || f.outgoing > 0).length };
  };
  const now = side(year);
  if (!now.n) return null;
  const prior = side(year - 1);
  const strip = ({ income, outgoing, net }: YearSide): YearSide => ({ income, outgoing, net });
  return { year, months: Number(through), now: strip(now), prior: prior.n ? strip(prior) : null };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
