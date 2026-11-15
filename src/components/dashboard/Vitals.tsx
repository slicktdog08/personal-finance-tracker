import Link from "next/link";
import { Icon, Money, type IconName } from "@/components/ds";
import type { Vitals as VitalsData } from "@/server/lib/dashboard-vitals";
import { shortMonthLabel } from "@/server/lib/period";

/**
 * Four ratios that say how the household is doing without reading a single balance: how long the
 * cash would last, how much of each paycheck is kept, how loaded the cards are, and what the debt
 * costs to carry. Each is a number a person can steer by, and each links to where it's worked on.
 *
 * Runway and savings rate are averaged over the last complete months (see computeVitals) — the
 * month in progress would swing them every day. Only the figure carries a tone; the tiles never do.
 */
export function Vitals({
  vitals: v,
  cash,
  utilization,
  creditOwed,
  creditLimit,
  interest,
}: {
  vitals: VitalsData;
  cash: number | null;
  /** Card balances as a percentage of their limits; null when no limit is recorded. */
  utilization: number | null;
  creditOwed: number;
  creditLimit: number;
  /** What every card and loan charges in interest per month at today's balances. */
  interest: number;
}) {
  const span =
    v.basis.length > 1
      ? `${monthOnly(v.basis[0])}–${monthOnly(v.basis[v.basis.length - 1])} average`
      : v.basis.length === 1
        ? `${monthOnly(v.basis[0])} only`
        : null;
  const runway = v.runwayMonths;
  const rate = v.savingsRate;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-6 gap-y-5">
      <Tile
        href="/trends"
        icon="heart-pulse"
        label="Runway"
        tone={runway == null ? undefined : runway < 1 ? "over" : runway < 3 ? "warn" : undefined}
        value={
          runway == null ? null : (
            <>
              {runway >= 24 ? "24+" : runway.toFixed(1)} <Unit>months</Unit>
            </>
          )
        }
        sub={
          runway != null && v.avgOutgoing != null ? (
            <>
              <Money value={cash ?? 0} kind="neutral" whole /> cash at <Money value={v.avgOutgoing} kind="neutral" whole />
              /mo out · {span}
            </>
          ) : (
            "Needs a recorded cash balance and a finished month of spending."
          )
        }
      />
      <Tile
        href="/trends"
        icon="piggy-bank"
        label="Savings rate"
        tone={rate == null ? undefined : rate < 0 ? "over" : rate >= 20 ? "income" : undefined}
        value={rate == null ? null : <>{Math.round(rate)}%</>}
        sub={
          rate != null && v.avgKept != null ? (
            v.avgKept >= 0 ? (
              <>
                Keeping <Money value={v.avgKept} kind="neutral" whole />
                /mo of what comes in · {span}
              </>
            ) : (
              <>
                Spending <Money value={-v.avgKept} kind="neutral" whole />
                /mo more than comes in · {span}
              </>
            )
          ) : (
            "Needs a finished month with income."
          )
        }
      />
      <Tile
        href="/debts"
        icon="credit-card"
        label="Card utilization"
        tone={utilization == null ? undefined : utilization >= 50 ? "over" : utilization >= 30 ? "warn" : undefined}
        value={utilization == null ? null : <>{Math.round(utilization)}%</>}
        sub={
          utilization != null ? (
            <>
              <Money value={creditOwed} kind="neutral" whole /> of <Money value={creditLimit} kind="neutral" whole /> in limits
              {utilization >= 30 ? " · under 30% is the usual target" : ""}
            </>
          ) : (
            "Add credit limits to your cards to see this."
          )
        }
      />
      <Tile
        href="/debts"
        icon="trending-down"
        label="Cost of debt"
        tone={interest > 0 ? "warn" : undefined}
        value={
          <>
            <Money value={interest} kind="neutral" />
            <Unit>/mo</Unit>
          </>
        }
        sub={
          interest > 0 ? (
            <>
              Interest at today&apos;s balances, about <Money value={interest * 12} kind="neutral" whole /> a year
            </>
          ) : (
            "Nothing is charging interest."
          )
        }
      />
    </div>
  );
}

const TONE = { over: "text-over", warn: "text-warn", income: "text-income" } as const;

function Tile({
  href,
  icon,
  label,
  value,
  sub,
  tone,
}: {
  href: string;
  icon: IconName;
  label: string;
  value: React.ReactNode | null;
  sub: React.ReactNode;
  tone?: keyof typeof TONE;
}) {
  return (
    <Link href={href} className="mp-stat -m-2 rounded-control p-2 transition-colors hover:bg-hover">
      <div className="mp-stat__label">
        <Icon name={icon} size={14} />
        {label}
      </div>
      {/* Money inside the value inherits the tone rather than its own ink. */}
      <div className={`mp-stat__value ${tone ? `${TONE[tone]} [&_*]:!text-inherit` : ""}`}>{value ?? <span className="text-fg-3">—</span>}</div>
      <div className="text-xs leading-snug text-fg-2 text-pretty">{sub}</div>
    </Link>
  );
}

const Unit = ({ children }: { children: React.ReactNode }) => <span className="text-sm font-medium text-fg-2">{children}</span>;

/** "2026-09" → "Sep". */
const monthOnly = (label: string) => shortMonthLabel(label).replace(/ '\d\d$/, "");
