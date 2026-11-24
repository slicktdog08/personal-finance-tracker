import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { SetupNotice } from "@/components/SetupNotice";
import { PaceSettingsForm } from "@/components/settings/PaceSettingsForm";
import { requireSession } from "@/server/auth/session";
import { getCategoryRows } from "@/server/queries";
import { getPaceConfig } from "@/server/pace";

export const dynamic = "force-dynamic";

export default async function PaceSettingsPage() {
  await requireSession();
  let cfg, cats;
  try {
    [cfg, cats] = await Promise.all([getPaceConfig(), getCategoryRows()]);
  } catch (e) {
    return <SetupNotice error={e} />;
  }
  return (
    <div className="space-y-5">
      <SettingsHeader
        reorder={false}
        title="Spending pace"
        description="How the pace monitor sets its allowances and when it changes status. Break-even and target are always recomputed from your income, bills and essentials; these settings only shape how."
      />
      <PaceSettingsForm initial={cfg} categories={cats.map((c) => c.name)} />
    </div>
  );
}
