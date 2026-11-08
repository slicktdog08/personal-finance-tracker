import { Badge, Glyph, Money, type IconName } from "@/components/ds";
import type { CashEvent } from "@/server/lib/cash-projection";
import { billIcon } from "@/components/bills/billGlyph";
import { LinkRow, dayLabel } from "./kit";

/** What the page knows about the bill behind an event (events carry labels, not ids). */
export interface ComingUpMeta {
  status?: string | null;
  statusColor?: string | null;
  paymentType?: string | null;
}

/**
 * The next week of scheduled money, straight from the projection's events: paychecks, unpaid bills,
 * debt payments and pending charges, one row each in date order. A bill past its due day is drawn
 * first, with a "Past due" badge in the status's own color. Everyday spending isn't an event, so its
 * daily rate rides along in the footer rather than being invented as line items.
 */
export function ComingUp({
  events,
  from,
  through,
  dailySpend,
  meta = {},
  pastDueColor,
  href = "/months",
}: {
  events: CashEvent[];
  from: string; // exclusive — the projection's anchor day
  through: string; // inclusive
  dailySpend: number;
  /** Keyed by event label. */
  meta?: Record<string, ComingUpMeta>;
  /** The "Past Due" status color, for the badge and glyph of overdue rows. */
  pastDueColor?: string | null;
  /** Where a row leads — the month's bills. */
  href?: string;
}) {
  const soon = events
    .filter((e) => e.date > from && e.date <= through)
    // Past due first (oldest debt of attention), then by date — the kit's reading order.
    .sort((a, b) => Number(!!b.overdue) - Number(!!a.overdue) || a.date.localeCompare(b.date));
  const out = soon.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0);
  const inn = soon.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
  const bills = soon.filter((e) => e.kind === "bill" || e.kind === "debt").length;

  if (soon.length === 0)
    return (
      <p className="py-2 text-sm text-fg-2">
        Nothing scheduled in the next week. <i>Todo al día.</i>
      </p>
    );

  return (
    <div>
      <div>
        {soon.map((e, i) => {
          const m = meta[e.label] ?? {};
          const pending = m.status != null && /pending/i.test(m.status);
          const color = e.overdue ? (pending ? m.statusColor : pastDueColor ?? "#e11d48") : e.kind === "paycheck" ? "#10b981" : m.statusColor;
          const icon: IconName = e.kind === "paycheck" ? "banknote" : e.kind === "pending" ? "clock-3" : billIcon(e.label, e.kind === "debt");
          return (
            <LinkRow
              key={`${e.date}-${e.label}-${i}`}
              href={e.kind === "paycheck" ? "/settings/pay-schedule" : e.kind === "pending" ? "/transactions?pending=1" : href}
              lead={<Glyph icon={icon} color={color} />}
              title={e.label}
              sub={
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  {e.overdue ? (
                    pending ? (
                      <Badge label={m.status} variant="pending" size="sm" />
                    ) : (
                      <Badge label="Past due" color={pastDueColor ?? "#e11d48"} size="sm" />
                    )
                  ) : (
                    <span>{dayLabel(e.date)}</span>
                  )}
                  {(m.paymentType || e.kind !== "bill") && (
                    <span className="truncate">· {m.paymentType ?? (e.kind === "paycheck" ? "Paycheck" : e.kind === "debt" ? "Debt payment" : "Pending charge")}</span>
                  )}
                </span>
              }
              end={<Money value={e.amount} kind={e.overdue && !pending ? "over" : "auto"} />}
            />
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[13px]">
        <span className="text-fg-2">
          {bills} {bills === 1 ? "payment" : "payments"}
          {inn > 0 && (
            <>
              {" · "}
              <Money value={inn} kind="income" /> in
            </>
          )}
          {dailySpend > 0 && (
            <>
              {" · plus ~"}
              <Money value={dailySpend} kind="neutral" sign="none" />
              /day everyday spend
            </>
          )}
        </span>
        <Money value={-out} className="font-semibold" />
      </div>
    </div>
  );
}
