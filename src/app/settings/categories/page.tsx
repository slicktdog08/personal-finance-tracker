import { SetupNotice } from "@/components/SetupNotice";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { CategoryList } from "@/components/settings/CategoryList";
import { getCategoryRows, getCategoryCounts } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  let categoryRows, counts;
  try {
    [categoryRows, counts] = await Promise.all([getCategoryRows(), getCategoryCounts()]);
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }

  return (
    <div className="space-y-5">
      <SettingsHeader
        title="Categories 📂"
        description="Transaction categories. Disable one to hide it when categorizing new transactions (existing ones keep it). Deleting requires reassigning its transactions to another category first."
      />
      <CategoryList
        categories={categoryRows.map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color,
          emoji: c.emoji,
          count: counts.get(c.name) ?? 0,
          active: !!c.active,
        }))}
      />
    </div>
  );
}
