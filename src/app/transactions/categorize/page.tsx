import { PageHeader } from "@/components/ds";
import { SetupNotice } from "@/components/SetupNotice";
import { MassCategorize } from "@/components/transactions/MassCategorize";
import {
  getUncategorizedCount,
  getCategoryOptionsRich,
  getCategoryRules,
  getSuggestedRules,
} from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function CategorizePage() {
  let uncategorized, catOptions, rules, suggestions;
  try {
    [uncategorized, catOptions, rules, suggestions] = await Promise.all([
      getUncategorizedCount(),
      getCategoryOptionsRich(),
      getCategoryRules(),
      getSuggestedRules(20),
    ]);
  } catch (e) {
    return <SetupNotice error={e} />;
  }

  return (
    <div className="space-y-4">
      {/* No back link: the Activity sub-tabs above lead back to Transactions. The kit titles
          every Activity view "Activity"; the sub-tab names the view. */}
      <PageHeader title="Activity" />

      <MassCategorize
        uncategorized={uncategorized}
        categoryOptions={catOptions}
        suggestions={suggestions}
        rules={rules}
      />
    </div>
  );
}
