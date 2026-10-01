"use client";

import { useState } from "react";
import { ImportWizard } from "@/components/import/ImportWizard";
import { PdfImportWizard } from "@/components/import/PdfImportWizard";
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

  const tabCls = (active: boolean) =>
    `px-4 py-2 rounded-md text-sm font-medium transition-colors ${
      active
        ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
        : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
    }`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <button onClick={() => setTab("csv")} className={tabCls(tab === "csv")}>
          CSV file
        </button>
        <button onClick={() => setTab("pdf")} className={tabCls(tab === "pdf")}>
          PDF statements
        </button>
      </div>

      {tab === "csv" ? (
        <ImportWizard accounts={accounts} categoryOptions={categoryOptions} rules={rules} />
      ) : (
        <PdfImportWizard accounts={accounts} categoryOptions={categoryOptions} rules={rules} />
      )}
    </div>
  );
}
