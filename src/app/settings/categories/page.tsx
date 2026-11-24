import { SetupNotice } from "@/components/SetupNotice";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { CategoryList } from "@/components/settings/CategoryList";
import { CategorizeWithAdvisor } from "@/components/advisor/CategorizeWithAdvisor";
import { getCategoryRows, getCategoryCounts, getUncategorizedCount } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  let categoryRows, counts, uncategorized;
  try {
    [categoryRows, counts, uncategorized] = await Promise.all([getCategoryRows(), getCategoryCounts(), getUncategorizedCount()]);
  } catch (e) {
    return <SetupNotice error={e} />;
  }

  return (
    <div className="space-y-5">
      <SettingsHeader
        title="Categories"
        description="Transaction categories. Disable one to hide it when categorizing new transactions (existing ones keep it). Deleting requires reassigning its transactions to another category first."
      />
      <CategorizeWithAdvisor uncategorized={uncategorized} />
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
