import { SetupNotice } from "@/components/SetupNotice";
import { AddGoal, type AcctOption } from "@/components/goals/AddGoal";
import { GoalCard } from "@/components/goals/GoalCard";
import { getGoalsWithProgress, getGoalContributions, getAccounts } from "@/server/queries";
import { formatMoney } from "@/server/lib/money";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  let goals, accounts;
  try {
    [goals, accounts] = await Promise.all([getGoalsWithProgress(), getAccounts()]);
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
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
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Goals</h1>
          <p className="text-sm text-neutral-500">
            Savings goals &amp; funding initiatives — fund each from cash on hand and track how close
            you are. Link a funding account and a goal <strong>regresses</strong> if that account dips
            below what you&apos;ve allocated.
          </p>
        </div>
        <AddGoal accounts={acctOptions} />
      </div>

      {active.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Active goals" value={String(active.length)} />
          <Stat label="Total saved" value={formatMoney(totalFunded)} tone="green" />
          <Stat label="Total target" value={formatMoney(totalTarget)} />
          <Stat
            label={totalShortfall > 0 ? "Under-funded" : "Overall progress"}
            value={totalShortfall > 0 ? formatMoney(totalShortfall) : `${overallPct.toFixed(0)}%`}
            tone={totalShortfall > 0 ? "red" : "blue"}
          />
        </div>
      )}

      <div className="space-y-4">
        {active.map((g) => (
          <GoalCard
            key={g.id}
            goal={g}
            contributions={contribByGoal.get(g.id) ?? []}
            accounts={acctOptions}
          />
        ))}
        {goals.length === 0 && (
          <div className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-8 text-center">
            <p className="text-sm text-neutral-500">
              No goals yet. Create your first — an emergency fund, a future purchase, or a
              debt-payoff target.
            </p>
          </div>
        )}
      </div>

      {archived.length > 0 && (
        <details>
          <summary className="text-sm text-neutral-500 cursor-pointer">
            Archived ({archived.length})
          </summary>
          <div className="space-y-4 mt-3">
            {archived.map((g) => (
              <GoalCard
                key={g.id}
                goal={g}
                contributions={contribByGoal.get(g.id) ?? []}
                accounts={acctOptions}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "blue" | "red";
}) {
  const tones: Record<string, string> = {
    green: "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/30",
    blue: "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30",
    red: "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30",
  };
  return (
    <div
      className={`rounded-lg border p-4 ${
        tone ? tones[tone] : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
