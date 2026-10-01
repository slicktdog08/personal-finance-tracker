import { SetupNotice } from "@/components/SetupNotice";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { StatusList } from "@/components/settings/StatusList";
import { getStatusRows } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function StatusesPage() {
  let statuses;
  try {
    statuses = await getStatusRows();
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }

  return (
    <div className="space-y-5">
      <SettingsHeader
        title="Bill Statuses 🏷️"
        description="The statuses you assign to bills each month. “Settled” statuses count toward the paid-off percentage on the months view."
      />
      <StatusList
        statuses={statuses.map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color,
          emoji: s.emoji,
          isSettled: s.isSettled,
        }))}
      />
    </div>
  );
}
