import { SetupNotice } from "@/components/SetupNotice";
import { ImportTabs } from "@/components/import/ImportTabs";
import { getAccounts, getCategoryOptionsRich, getCategoryRules } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  let accounts, catOptions, rules;
  try {
    [accounts, catOptions, rules] = await Promise.all([
      getAccounts(),
      getCategoryOptionsRich(),
      getCategoryRules(),
    ]);
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }

  return (
    <ImportTabs
      accounts={accounts.map((a) => ({ id: a.id, accountNumber: a.accountNumber, label: a.label }))}
      categoryOptions={catOptions}
      rules={rules}
    />
  );
}
