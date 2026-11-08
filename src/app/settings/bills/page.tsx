import { SettingsBackLink } from "@/components/settings/SettingsHeader";
import { Badge, Card, DataTable, EmptyState, Glyph, Money, PageHeader } from "@/components/ds";
import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import { RecurringSuggestions } from "@/components/bills/RecurringSuggestions";
import {
  getBills,
  getAllInstancesWithPeriod,
  getStatusConfig,
  getRecurringSuggestions,
  getBillNames,
} from "@/server/queries";
import { toNum } from "@/server/lib/money";
import { billIcon } from "@/components/bills/billGlyph";

export const dynamic = "force-dynamic";

export default async function BillsPage() {
  let bills, instances, statusConfig, suggestions, billNames;
  try {
    [bills, instances, statusConfig, suggestions, billNames] = await Promise.all([
      getBills(),
      getAllInstancesWithPeriod(),
      getStatusConfig(),
      getRecurringSuggestions(),
      getBillNames(),
    ]);
  } catch (e) {
    return <SetupNotice error={e} />;
  }

  const settled = new Set(statusConfig.filter((s) => s.isSettled).map((s) => s.name));
  type Stat = { months: number; timesPaid: number; billed: number; paid: number };
  const stats = new Map<number, Stat>();
  for (const i of instances) {
    if (i.billId == null) continue;
    const s = stats.get(i.billId) ?? { months: 0, timesPaid: 0, billed: 0, paid: 0 };
    s.months += 1;
    const amt = toNum(i.amount) ?? 0;
    s.billed += amt;
    if (settled.has(i.status)) {
      s.timesPaid += 1;
      s.paid += amt;
    }
    stats.set(i.billId, s);
  }

  const sorted = [...bills].sort((a, b) => {
    const sa = stats.get(a.id)?.paid ?? 0;
    const sb = stats.get(b.id)?.paid ?? 0;
    return sb - sa;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        showTitleOnMobile
        eyebrow={<SettingsBackLink />}
        title="Recurring bills"
        description={
          <>
            Every recurring bill across all months. Open one for its full history and to consolidate
            duplicates. Each month&apos;s bills carry over from the previous one — edit a month under <Link href="/months" className="text-accent-text hover:underline">Bills</Link>.
          </>
        }
      />

      <RecurringSuggestions suggestions={suggestions} bills={billNames} />

      <Card title="All bills" meta={`${sorted.length}`} padded={false}>
        <DataTable
          rows={sorted.map((b) => ({ ...b, s: stats.get(b.id) ?? { months: 0, timesPaid: 0, billed: 0, paid: 0 } }))}
          columns={[
            {
              key: "name",
              header: "Bill",
              render: (b) => (
                <span className="flex min-w-0 items-center gap-2.5">
                  <Glyph icon={billIcon(b.name, b.isDebt)} size="sm" />
                  <Link href={`/settings/bills/${b.id}`} className="truncate font-medium text-fg hover:text-accent-text hover:underline">
                    {b.name}
                  </Link>
                  {b.isDebt && <Badge label="Debt" variant="outline" size="sm" dot={false} />}
                </span>
              ),
            },
            { key: "months", header: "Months", num: true, render: (b) => b.s.months },
            { key: "timesPaid", header: "Times paid", num: true, render: (b) => b.s.timesPaid },
            { key: "billed", header: "Total billed", num: true, render: (b) => <Money value={b.s.billed} kind="neutral" /> },
            { key: "paid", header: "Total paid", num: true, render: (b) => <Money value={b.s.paid} kind="neutral" /> },
          ]}
          mobile={{
            lead: (b) => <Glyph icon={billIcon(b.name, b.isDebt)} />,
            title: (b) => (
              <Link href={`/settings/bills/${b.id}`} className="hover:text-accent-text">
                {b.name}
              </Link>
            ),
            sub: (b) => (
              <>
                {b.isDebt && <Badge label="Debt" variant="outline" size="sm" dot={false} />}
                <span>
                  {b.s.months} month{b.s.months === 1 ? "" : "s"} · paid {b.s.timesPaid}×
                </span>
              </>
            ),
            amount: (b) => <Money value={b.s.paid} kind="neutral" />,
            meta: (b) => (
              <>
                of <Money value={b.s.billed} kind="neutral" /> billed
              </>
            ),
          }}
          empty={<EmptyState compact icon="receipt" title="No bills yet" body="Bills show up here once you add one to a month." />}
        />
      </Card>
    </div>
  );
}
