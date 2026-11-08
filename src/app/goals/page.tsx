import { SetupNotice } from "@/components/SetupNotice";
import { AddGoal, type AcctOption } from "@/components/goals/AddGoal";
import { GoalCard } from "@/components/goals/GoalCard";
import { getGoalsWithProgress, getGoalContributions, getAccounts } from "@/server/queries";
import { Card, EmptyState, Icon, PageHeader, StatTile } from "@/components/ds";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  let goals, accounts;
  try {
    [goals, accounts] = await Promise.all([getGoalsWithProgress(), getAccounts()]);
  } catch (e) {
    return <SetupNotice error={e} />;
  }

  // Contribution ledger per goal (few goals in practice — fetch in parallel).
  const contribLists = await Promise.all(goals.map((g) => getGoalContributions(g.id)));
  const contribByGoal = new Map(goals.map((g, i) => [g.id, contribLists[i]]));

  const acctOptions: AcctOption[] = accounts.map((a) => ({
    id: a.id,
    label: a.label,
    accountNumber: a.accountNumber,
    accountType: a.accountType,
  }));

  const active = goals.filter((g) => g.status !== "archived");
  const archived = goals.filter((g) => g.status === "archived");

  const totalTarget = active.reduce((s, g) => s + g.targetAmount, 0);
  const totalFunded = active.reduce((s, g) => s + g.funded, 0);
  const totalShortfall = active.reduce((s, g) => s + g.shortfall, 0);
  const overallPct = totalTarget > 0 ? (totalFunded / totalTarget) * 100 : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Goals"
        description="Money you've set aside on purpose. Link a funding account and we'll tell you if it dips below what you've promised."
        actions={<AddGoal accounts={acctOptions} />}
      />

      {active.length > 0 && (
        <div className="mp-grid mp-grid--keep2" style={{ "--cols": 4 } as React.CSSProperties}>
          <Card>
            <StatTile size="sm" label="Active goals" value={String(active.length)} />
          </Card>
          <Card>
            <StatTile size="sm" label="Saved" value={totalFunded} kind="income" />
          </Card>
          <Card>
            <StatTile size="sm" label="Target" value={totalTarget} />
          </Card>
          <Card>
            {totalShortfall > 0 ? (
              <StatTile size="sm" label="Under-funded" value={totalShortfall} kind="over" />
            ) : (
              <StatTile size="sm" label="Overall progress" value={`${overallPct.toFixed(0)}%`} />
            )}
          </Card>
        </div>
      )}

      <div className="space-y-4">
        {active.map((g) => (
          <GoalCard key={g.id} goal={g} contributions={contribByGoal.get(g.id) ?? []} accounts={acctOptions} />
        ))}
        {goals.length === 0 && (
          <Card>
            <EmptyState icon="target" title="No goals yet" body="Create your first — an emergency fund, a future purchase, or a debt-payoff target." />
          </Card>
        )}
      </div>

      {archived.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-fg-2 hover:text-fg">
            <Icon name="chevron-right" size={14} className="transition-transform group-open:rotate-90" />
            Archived ({archived.length})
          </summary>
          <div className="mt-3 space-y-4">
            {archived.map((g) => (
              <GoalCard key={g.id} goal={g} contributions={contribByGoal.get(g.id) ?? []} accounts={acctOptions} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
