"use client";

import { useState, useTransition } from "react";
import { ImportWizard } from "@/components/import/ImportWizard";
import { PdfImportWizard } from "@/components/import/PdfImportWizard";
import { Button, PageHeader, SubTabs } from "@/components/ds";
import { resyncTransactionPeriods } from "@/server/actions/transactions";
import type { CategoryOption } from "@/server/queries";
import type { CategoryRule } from "@/server/lib/categorize";

interface Account {
  id: number;
  accountNumber: string;
  label: string | null;
}

export function ImportTabs({
  accounts,
  categoryOptions,
  rules,
}: {
  accounts: Account[];
  categoryOptions: CategoryOption[];
  rules: CategoryRule[];
}) {
  const [tab, setTab] = useState<"csv" | "pdf">("csv");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Import"
        description="CSV or PDF statements. Nothing is saved until you review it."
        actions={<ResyncPeriodsButton />}
      />
      <SubTabs
        label="Import source"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "csv", label: "CSV file" },
          { value: "pdf", label: "PDF statements" },
        ]}
      />

      {tab === "csv" ? (
        <ImportWizard accounts={accounts} categoryOptions={categoryOptions} rules={rules} />
      ) : (
        <PdfImportWizard accounts={accounts} categoryOptions={categoryOptions} rules={rules} />
      )}
    </div>
  );
}

// Maintenance: re-attach every transaction to the month (period) its date falls in. Independent
// of any file, so it lives in the page header rather than inside a wizard step.
function ResyncPeriodsButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex flex-wrap items-center gap-2">
      {msg && <span className="text-xs text-fg-3">{msg}</span>}
      <Button
        variant="secondary"
        size="sm"
        icon="refresh-cw"
        loading={pending}
        title="Re-link every transaction to the month its date falls in"
        onClick={() =>
          start(async () => {
            const n = await resyncTransactionPeriods();
            setMsg(`Linked ${n} transaction${n === 1 ? "" : "s"} to their month.`);
          })
        }
      >
        Re-sync months
      </Button>
    </span>
  );
}
