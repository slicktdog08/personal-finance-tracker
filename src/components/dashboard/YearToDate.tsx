import { Money } from "@/components/ds";
import type { YearToDate as YearData } from "@/server/lib/dashboard-vitals";
import { MONTH_ABBR } from "@/server/lib/period";
import { formatMoney } from "@/server/lib/money";

/**
 * The year so far beside the same months of the year before. A single month is noisy — rent lands,
 * a paycheck slips to the 1st — and the long charts live on Trends; this is the one-glance "am I
 * ahead of where I was?" in between. Spending going up is the bad direction, so it is toned the
 * opposite way from income.
 */
export function YearToDate({ data: d }: { data: YearData }) {
  const rate = d.now.income > 0 ? (d.now.net / d.now.income) * 100 : null;
  const span = d.months > 1 ? `Jan–${MONTH_ABBR[d.months - 1]}` : "Jan";
  return (
    <div>
      <dl className="grid grid-cols-3 gap-x-4">
        <Figure label="In" value={d.now.income} was={d.prior?.income} goodWhenUp />
        <Figure label="Out" value={d.now.outgoing} was={d.prior?.outgoing} goodWhenUp={false} />
        <Figure label="Kept" value={d.now.net} was={d.prior?.net} goodWhenUp signed />
      </dl>
      <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-fg-2">
        {rate != null ? (
          d.now.net >= 0 ? (
            <>
              Kept <strong className="font-semibold text-fg">{Math.round(rate)}%</strong> of what came in, {span} {d.year}.
            </>
          ) : (
            <>
              Spent <strong className="font-semibold text-over">{formatMoney(-d.now.net)}</strong> more than came in, {span} {d.year}.
            </>
          )
        ) : (
          <>No income recorded for {span} {d.year}.</>
        )}{" "}
        {d.prior ? `Compared with ${span} ${d.year - 1}.` : `Nothing recorded for ${span} ${d.year - 1} to compare against.`} Transfers between your own accounts aren&apos;t counted.
      </p>
    </div>
  );
}

function Figure({ label, value, was, goodWhenUp, signed }: { label: string; value: number; was?: number; goodWhenUp: boolean; signed?: boolean }) {
  const diff = was != null ? value - was : null;
  const flat = diff != null && Math.abs(diff) < 1;
  const good = diff != null && (diff > 0) === goodWhenUp;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-fg-3">{label}</dt>
      <dd className="mt-0.5 truncate text-lg font-semibold">
        <Money value={value} kind={signed ? (value >= 0 ? "income" : "over") : "neutral"} sign={signed ? "always" : "none"} whole />
      </dd>
      {diff != null && (
        <dd className={`mt-0.5 truncate text-[11px] ${flat ? "text-fg-3" : good ? "text-income" : "text-over"}`}>
          {flat ? "Same as last year" : `${diff > 0 ? "+" : "−"}${formatMoney(Math.abs(diff)).replace(/\.\d\d$/, "")} vs last year`}
        </dd>
      )}
    </div>
  );
}
