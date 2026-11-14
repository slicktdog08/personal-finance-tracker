import { SetupNotice } from "@/components/SetupNotice";
import { ImportTabs } from "@/components/import/ImportTabs";
import { getAccounts, getCategoryOptionsRich, getCategoryRules } from "@/server/queries";
import { getAccountAliases } from "@/server/lib/account-aliases";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  let accounts, catOptions, rules, aliases;
  try {
    [accounts, catOptions, rules, aliases] = await Promise.all([
      getAccounts(),
      getCategoryOptionsRich(),
      getCategoryRules(),
      getAccountAliases(),
    ]);
  } catch (e) {
    return <SetupNotice error={e} />;
  }

  // The pickers key on the account number, and a statement keeps the number printed on it (the
  // dedup hash is built from it). So a merged account is listed once more under each former
  // number: an old statement then shows as recognized, and still lands on the kept account.
  const choices = accounts.flatMap((a) => [
    { id: a.id, accountNumber: a.accountNumber, label: a.label },
    ...(aliases.get(a.id) ?? []).map((n) => ({
      id: a.id,
      accountNumber: n,
      label: `${a.label || a.institution || `••${a.accountNumber}`}, former number`,
    })),
  ]);

  return (
    <ImportTabs
      accounts={choices}
      categoryOptions={catOptions}
      rules={rules}
    />
  );
}
