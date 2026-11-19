import Link from "next/link";
import { Money, ProgressBar, StatTile } from "@/components/ds";
import type { SpendingPower as SpendingPowerData } from "@/server/lib/spending-power";

const CASH_COLOR = "var(--mp-accent)";
const CREDIT_COLOR = "#0ea5e9";

/**
 * Everything that could be spent right now: cash on hand plus the unused credit on open cards.
 * One bar for the split, then the two halves. It's a capacity, not a budget — Safe to spend is the
 * number that accounts for bills — so the copy says where it comes from and nothing more.
 */
export function SpendingPower({
  data,
  reservedForGoals,
  asOf,
}: {
  data: SpendingPowerData;
  /** Part of the cash backing savings goals — still spendable, but called out. */
  reservedForGoals: number;
  asOf: string | null;
}) {
  const { cash, creditAvailable, total, cards, missingLimit } = data;
  const barMax = Math.max(0, cash) + creditAvailable;
  return (
    <div>
      <StatTile
        label="Spending power"
        icon="zap"
        value={total}
        sub={<span className="block truncate">Cash on hand + available credit{asOf ? ` · as of ${asOf}` : ""}</span>}
      />
      {barMax > 0 && (
        <ProgressBar
          size="sm"
          className="mt-3"
          max={barMax}
          label="Cash vs available credit"
          segments={[
            { value: Math.max(0, cash), color: CASH_COLOR },
            { value: creditAvailable, color: CREDIT_COLOR },
          ]}
        />
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
        <Half color={CASH_COLOR} label="Cash" href="/accounts">
          <Money value={cash} kind="neutral" />
          {reservedForGoals > 0 && (
            <span className="block text-[11px] font-normal text-fg-3">
              <Money value={reservedForGoals} kind="neutral" whole /> in goals
            </span>
          )}
        </Half>
        <Half color={CREDIT_COLOR} label="Available credit" href="/debts">
          <Money value={creditAvailable} kind="neutral" />
          <span className="block truncate text-[11px] font-normal text-fg-3">
            {cards.length} card{cards.length === 1 ? "" : "s"}
            {missingLimit > 0 && <> · {missingLimit} without a limit</>}
          </span>
        </Half>
      </dl>
    </div>
  );
}

function Half({ color, label, href, children }: { color: string; label: string; href: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[11px] text-fg-3">
        <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: color }} />
        <Link href={href} className="hover:underline">
          {label}
        </Link>
      </dt>
      <dd className="text-sm font-semibold">{children}</dd>
    </div>
  );
}
