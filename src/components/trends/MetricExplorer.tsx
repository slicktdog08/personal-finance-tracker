"use client";

import { useState } from "react";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { Money } from "@/components/ds";
import { seriesStats } from "@/server/lib/trends";

export interface MetricSeries {
  key: string;
  name: string;
  /** What the readout calls it in a sentence — "cash on hand". */
  noun: string;
  color: string;
  /** Debts are good when they fall; everything else when it rises. */
  goodWhen: "up" | "down";
  values: (number | null)[];
}

/**
 * One chart, any balance: pick net worth, cash on hand, what's owed, retirement… and the chart
 * and the numbers under it follow — where it started and ended in the range, its high and low,
 * its average month, and its biggest single-month moves.
 */
export function MetricExplorer({ labels, series, initial }: { labels: string[]; series: MetricSeries[]; initial?: string }) {
  const [key, setKey] = useState(initial ?? series[0]?.key);
  const s = series.find((x) => x.key === key) ?? series[0];
  if (!s) return null;
  const points = labels.map((label, i) => ({ label, value: s.values[i] }));
  // Leading months with no value would squeeze the line into the right of the chart.
  const firstIdx = points.findIndex((p) => p.value != null);
  const shown = firstIdx < 0 ? [] : points.slice(firstIdx);
  const st = seriesStats(shown);
  const good = (v: number) => (Math.abs(v) < 0.5 ? "neutral" : (v > 0) === (s.goodWhen === "up") ? "income" : "over");

  return (
    <div className="space-y-4">
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="mp-seg" role="group" aria-label="Balance to chart">
          {series.map((x) => (
            <button key={x.key} type="button" aria-pressed={x.key === s.key} onClick={() => setKey(x.key)}>
              {x.name}
            </button>
          ))}
        </div>
      </div>

      {st ? (
        <>
          <TrendLineChart points={shown} color={s.color} label={`${s.name} by month`} goodWhen={s.goodWhen} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <Stat label={`Change since ${st.first.label}`}>
              <Money value={st.change} kind={good(st.change)} sign="always" />
              {st.changePct != null && <span className="ml-1 text-xs text-fg-3">{fmtPct(st.changePct)}</span>}
            </Stat>
            <Stat label="Per month">
              <Money value={st.perMonth} kind={good(st.perMonth)} sign="always" />
            </Stat>
            <Stat label={`High · ${st.high.label}`}>
              <Money value={st.high.value} kind="neutral" />
            </Stat>
            <Stat label={`Low · ${st.low.label}`}>
              <Money value={st.low.value} kind="neutral" />
            </Stat>
            <Stat label="Monthly average">
              <Money value={st.avg} kind="neutral" />
            </Stat>
            <Stat label="Biggest moves">
              {st.bestMove && st.worstMove ? (
                <span className="flex flex-col text-xs leading-5">
                  <span>
                    <Money value={st.bestMove.value} kind={good(st.bestMove.value)} sign="always" /> <span className="text-fg-3">{st.bestMove.label}</span>
                  </span>
                  <span>
                    <Money value={st.worstMove.value} kind={good(st.worstMove.value)} sign="always" /> <span className="text-fg-3">{st.worstMove.label}</span>
                  </span>
                </span>
              ) : (
                "—"
              )}
            </Stat>
          </dl>
        </>
      ) : (
        <p className="py-10 text-center text-sm text-fg-3">Not enough {s.noun} history in this range — it needs two recorded months.</p>
      )}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-fg-3">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{children}</dd>
    </div>
  );
}

const fmtPct = (p: number) => `${p >= 0 ? "+" : "−"}${Math.abs(p) >= 100 ? Math.abs(p).toFixed(0) : Math.abs(p).toFixed(1)}%`;
