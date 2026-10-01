import Link from "next/link";
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
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/transactions" className="text-sm text-neutral-500 hover:underline">
          ← Transactions
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Mass categorize</h1>
        <p className="text-sm text-neutral-500">
          Bulk-assign categories by matching description text, apply saved rules, and manage rules
          so future imports auto-categorize.
        </p>
      </div>

      <MassCategorize
        uncategorized={uncategorized}
        categoryOptions={catOptions}
        suggestions={suggestions}
        rules={rules}
      />
    </div>
  );
}
