import Link from "next/link";
import { Card, Notice, StatTile, buttonClass } from "@/components/ds";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { SetupNotice } from "@/components/SetupNotice";
import { getDataCoverageCounts } from "@/server/queries";
import { buildCoverage, type CoverageGap, type CoverageState, type GapKind } from "@/server/lib/coverage";
import { currentPeriodLabel, shortMonthLabel } from "@/server/lib/period";
import { todayIso } from "@/server/lib/pay-schedule";
import { ensureDataPeriods } from "@/server/periods";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data coverage" };

const STATE_STYLE: Record<CoverageState, { bg: string; label: string }> = {
  both: { bg: "var(--mp-money-income)", label: "Transactions + balances" },
  txns: { bg: "color-mix(in srgb, var(--mp-money-income) 45%, transparent)", label: "Transactions only" },
  balances: { bg: "var(--mp-money-pending)", label: "Balances only" },
  none: { bg: "color-mix(in srgb, var(--mp-money-over) 30%, transparent)", label: "Nothing on record" },
  outside: { bg: "transparent", label: "Account closed" },
};

const GAP_TEXT: Record<GapKind, string> = {
  inside: "Missing between records",
  after: "Missing since last record",
  before: "Before first record",
};

const fmtRange = (g: Pick<CoverageGap, "from" | "to">) => (g.from === g.to ? shortMonthLabel(g.from) : `${shortMonthLabel(g.from)} – ${shortMonthLabel(g.to)}`);

export default async function CoveragePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const sp = await searchParams;
  let counts;
  try {
    // Make sure every imported month has its sheet, so the links below land on real months.
    await ensureDataPeriods();
    counts = await getDataCoverageCounts();
  } catch (e) {
    return <SetupNotice error={e} />;
  }

  const today = todayIso();
  const to = currentPeriodLabel(today) ?? today.slice(0, 7);
  const thisYear = Number(to.slice(0, 4));
  const earliest = [...counts.txns, ...counts.balances].reduce<string | null>((m, r) => (r.month && (m == null || r.month < m) ? r.month : m), null);
  const earliestYear = earliest ? Number(earliest.slice(0, 4)) : thisYear;
  // Default window: from January of the earliest data, or 2019, whichever is earlier — the
  // point is to see the empty years you still mean to fill.
  const firstYearChoice = Math.min(earliestYear, 2019);
  const fromYear = sp.from && /^\d{4}$/.test(sp.from) ? Math.min(Number(sp.from), thisYear) : firstYearChoice;
  const from = `${fromYear}-01`;

  const accounts = [...counts.accounts, { id: null, label: "No account", institution: null, accountType: "", active: true }];
  const cov = buildCoverage({ accounts, txns: counts.txns, balances: counts.balances, from, to });
  const pct = cov.totals.expected ? Math.round((cov.totals.covered / cov.totals.expected) * 100) : 0;
  const years = [...new Set(cov.months.map((m) => m.slice(0, 4)))];
  const yearChoices = Array.from({ length: thisYear - firstYearChoice + 1 }, (_, i) => firstYearChoice + i);

  return (
    <div className="space-y-6">
      <SettingsHeader
        reorder={false}
        title="Data coverage"
        description="Which months the app holds transactions and balances for, account by account — and the stretches it holds nothing. Use it to find the statements still to import."
        actions={
          <Link href="/import" className={buttonClass({ variant: "secondary", size: "sm" })}>
            Import statements
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
        <span>From</span>
        <nav className="mp-seg" aria-label="Start year">
          {yearChoices.map((y) => (
            <Link key={y} href={y === firstYearChoice ? "/settings/coverage" : `/settings/coverage?from=${y}`} aria-current={y === fromYear ? "true" : undefined} scroll={false}>
              {y}
            </Link>
          ))}
        </nav>
      </div>

      <Card>
        <div className="mp-grid mp-grid--keep2" style={{ "--cols": 4 } as React.CSSProperties}>
          <StatTile label="Coverage" value={`${pct}%`} sub={`${cov.totals.covered} of ${cov.totals.expected} account-months`} />
          <StatTile label="Missing account-months" value={String(cov.totals.missingMonths)} sub={`since ${shortMonthLabel(from)}`} />
          <StatTile label="Holes inside a record" value={String(cov.totals.insideGaps)} sub="most likely a missed statement" />
          <StatTile label="Earliest data" value={earliest ? shortMonthLabel(earliest) : "—"} sub={`${cov.totals.accounts} account${cov.totals.accounts === 1 ? "" : "s"}`} />
        </div>
      </Card>

      {cov.rows.length === 0 ? (
        <Notice tone="info" title="Nothing on record yet">
          Import a statement or link a bank and coverage fills in here.
        </Notice>
      ) : (
        <Card title="By month" meta={`${shortMonthLabel(from)} – ${shortMonthLabel(to)}`} padded={false}>
          <div className="overflow-x-auto p-4">
            <table className="border-separate" style={{ borderSpacing: 2 }}>
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-surface pr-3" />
                  {years.map((y) => (
                    <th key={y} colSpan={cov.months.filter((m) => m.startsWith(y)).length} className="text-left text-[11px] font-medium text-fg-3">
                      {y}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {cov.rows.map((r) => (
                  <tr key={r.account.id ?? "none"}>
                    <th scope="row" className="sticky left-0 z-10 max-w-[180px] bg-surface pr-3 text-left font-normal">
                      <div className="truncate text-xs">{r.account.label}</div>
                      <div className="truncate text-[10px] text-fg-3">
                        {[r.account.institution, r.account.accountType, r.account.active ? null : "closed"].filter(Boolean).join(" · ")}
                      </div>
                    </th>
                    {r.cells.map((c) => {
                      const st = STATE_STYLE[c.state];
                      const title = `${r.account.label} · ${shortMonthLabel(c.month)}: ${c.txns} transaction${c.txns === 1 ? "" : "s"}, ${c.balances} balance${c.balances === 1 ? "" : "s"}`;
                      const box = (
                        <span
                          className="block h-3.5 w-3.5 rounded-[3px]"
                          style={{ backgroundColor: st.bg, outline: c.state === "outside" ? "1px dashed var(--mp-border-2)" : undefined, outlineOffset: -1 }}
                        />
                      );
                      return (
                        <td key={c.month} className="p-0" title={title}>
                          {c.txns > 0 && r.account.id != null ? (
                            <Link href={`/transactions?account=${r.account.id}&period=${c.month}`} aria-label={title}>
                              {box}
                            </Link>
                          ) : (
                            box
                          )}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap pl-3 text-right text-xs tabular-nums text-fg-3">
                      {r.expected ? Math.round((r.covered / r.expected) * 100) : 0}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-3 text-xs text-fg-3">
            {(Object.keys(STATE_STYLE) as CoverageState[]).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded-[3px]"
                  style={{ backgroundColor: STATE_STYLE[k].bg, outline: k === "outside" ? "1px dashed var(--mp-border-2)" : undefined, outlineOffset: -1 }}
                />
                {STATE_STYLE[k].label}
              </span>
            ))}
            <span>· Click a month to see its transactions.</span>
          </div>
        </Card>
      )}

      {cov.gaps.length > 0 && (
        <Card title="Gaps" meta={`${cov.gaps.length} stretch${cov.gaps.length === 1 ? "" : "es"} with no data, holes first`} padded={false}>
          <div className="overflow-x-auto">
            <table className="mp-table mp-table--dense">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Months</th>
                  <th className="is-right">Length</th>
                  <th className="hidden sm:table-cell">Kind</th>
                </tr>
              </thead>
              <tbody>
                {cov.gaps.map((g) => (
                  <tr key={`${g.accountId ?? "none"}-${g.from}`}>
                    <td className="truncate">{g.account}</td>
                    <td className="whitespace-nowrap">{fmtRange(g)}</td>
                    <td className="is-num">
                      {g.months} mo{g.months >= 12 ? ` (${(g.months / 12).toFixed(1)} yr)` : ""}
                    </td>
                    <td className={`hidden whitespace-nowrap sm:table-cell text-xs ${g.kind === "inside" ? "text-over" : "text-fg-3"}`}>{GAP_TEXT[g.kind]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-3 text-xs text-fg-3">
            &ldquo;Before first record&rdquo; can also mean the account didn&rsquo;t exist yet. A month with balances but no transactions counts as covered — a
            quiet account is fine.
          </p>
        </Card>
      )}
    </div>
  );
}
