"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ImportWizard } from "@/components/import/ImportWizard";
import { PdfImportWizard } from "@/components/import/PdfImportWizard";
import { Button, Icon, PageHeader, SubTabs, type IconName } from "@/components/ds";
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

      <OtherWays />
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

// Files are one way in, not the only one. People land here looking for "how do I get my
// transactions into this", so the page also points at the routes that aren't a file upload.
const OTHER_WAYS: { icon: IconName; title: string; body: string; href: string; cta: string }[] = [
  {
    icon: "refresh-cw",
    title: "Connect a bank",
    body: "Link accounts through SimpleFIN or Plaid and transactions, pending charges and balances arrive on their own.",
    href: "/settings/sync",
    cta: "Bank Sync settings",
  },
  {
    icon: "plus",
    title: "Type one in",
    body: "Add a single transaction by hand — a cash purchase, or a pending charge that will settle into the bank's version later.",
    href: "/transactions",
    cta: "Open Activity",
  },
  {
    icon: "message-circle",
    title: "Ask Claude",
    body: "With the MCP connector set up, Claude can record a transaction or a balance for you, after showing you what it will add.",
    href: "/advisor",
    cta: "Advisor",
  },
];

function OtherWays() {
  return (
    <section aria-labelledby="other-ways" className="space-y-3 border-t border-line pt-5">
      <h2 id="other-ways" className="text-sm font-semibold text-fg-2">
        Other ways to get transactions in
      </h2>
      <ul className="grid gap-3 sm:grid-cols-3">
        {OTHER_WAYS.map((w) => (
          <li key={w.href} className="rounded-card border border-line bg-surface p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Icon name={w.icon} size={16} className="text-fg-3" />
              {w.title}
            </div>
            <p className="mt-1.5 text-sm text-fg-2">{w.body}</p>
            <Link href={w.href} className="mt-2 inline-block text-sm font-medium text-accent-text hover:underline">
              {w.cta} →
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
