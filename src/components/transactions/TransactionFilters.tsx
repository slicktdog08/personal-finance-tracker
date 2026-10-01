"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MultiSelect } from "@/components/MultiSelect";
import type { CategoryOption } from "@/server/queries";

// A single small debounce covers both requested cases: typing in the search box,
// and toggling several checkboxes quickly — rapid changes coalesce into one
// navigation instead of firing one per keystroke/click.
const DEBOUNCE_MS = 300;

interface AccountOption {
  id: number;
  accountNumber: string;
  label: string | null;
}

export function TransactionFilters({
  periods,
  accounts,
  categoryOptions,
  initial,
}: {
  periods: { label: string }[];
  accounts: AccountOption[];
  categoryOptions: CategoryOption[];
  initial: {
    periodLabels: string[];
    accountIds: string[];
    categories: string[];
    direction: string;
    search: string;
    uncategorized: boolean;
    pending: boolean;
  };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [periodLabels, setPeriodLabels] = useState(initial.periodLabels);
  const [accountIds, setAccountIds] = useState(initial.accountIds);
  const [categories, setCategories] = useState(initial.categories);
  const [direction, setDirection] = useState(initial.direction);
  const [search, setSearch] = useState(initial.search);
  const [uncategorized, setUncategorized] = useState(initial.uncategorized);
  const [pendingOnly, setPendingOnly] = useState(initial.pending);

  // Push the current selection to the URL as a soft navigation, debounced so
  // rapid changes coalesce. Skips the initial mount so we don't re-navigate to
  // the URL we just came from. Preserves unmanaged params (sort/dir/size) and
  // resets to page 1. Reads window.location at fire time so it always builds on
  // the latest URL (e.g. after the table changed sort/page).
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    const t = setTimeout(() => {
      const next = new URLSearchParams(window.location.search);
      next.delete("period");
      periodLabels.forEach((v) => next.append("period", v));
      next.delete("account");
      accountIds.forEach((v) => next.append("account", v));
      next.delete("category");
      categories.forEach((v) => next.append("category", v));
      if (direction) next.set("direction", direction);
      else next.delete("direction");
      const s = search.trim();
      if (s) next.set("q", s);
      else next.delete("q");
      if (uncategorized) next.set("uncat", "1");
      else next.delete("uncat");
      if (pendingOnly) next.set("pending", "1");
      else next.delete("pending");
      next.delete("page"); // any filter change returns to page 1
      startTransition(() => router.replace(`/transactions?${next.toString()}`, { scroll: false }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [periodLabels, accountIds, categories, direction, search, uncategorized, pendingOnly, router]);

  const hasFilters =
    periodLabels.length > 0 ||
    accountIds.length > 0 ||
    categories.length > 0 ||
    direction !== "" ||
    search !== "" ||
    uncategorized ||
    pendingOnly;

  function reset() {
    setPeriodLabels([]);
    setAccountIds([]);
    setCategories([]);
    setDirection("");
    setSearch("");
    setUncategorized(false);
    setPendingOnly(false);
  }

  const inputCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";

  return (
    <div className="grid grid-cols-2 gap-2 items-end sm:flex sm:flex-wrap">
      <Field label="Month">
        <MultiSelect
          value={periodLabels}
          onChange={setPeriodLabels}
          options={periods.map((p) => ({ value: p.label, label: p.label }))}
        />
      </Field>
      <Field label="Account">
        <MultiSelect
          value={accountIds}
          onChange={setAccountIds}
          options={accounts.map((a) => ({
            value: String(a.id),
            label: a.label ? `${a.label} (${a.accountNumber})` : a.accountNumber,
          }))}
        />
      </Field>
      <Field label="Category">
        <MultiSelect
          value={categories}
          onChange={setCategories}
          options={categoryOptions.map((c) => ({
            value: c.name,
            label: `${c.emoji ? `${c.emoji} ` : ""}${c.name}`,
          }))}
        />
      </Field>
      <Field label="Direction">
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          className={inputCls + " w-full sm:w-auto"}
        >
          <option value="">All</option>
          <option value="Debit">Debit</option>
          <option value="Credit">Credit</option>
        </select>
      </Field>
      <Field label="Search">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={inputCls + " w-full sm:w-auto"}
          placeholder="description…"
        />
      </Field>
      <label className="flex items-center gap-1 text-sm pb-1.5">
        <input
          type="checkbox"
          checked={uncategorized}
          onChange={(e) => setUncategorized(e.target.checked)}
        />
        Uncategorized only
      </label>
      <label className="flex items-center gap-1 text-sm pb-1.5">
        <input
          type="checkbox"
          checked={pendingOnly}
          onChange={(e) => setPendingOnly(e.target.checked)}
        />
        Pending only
      </label>
      {hasFilters && (
        <button onClick={reset} className="px-3 py-1.5 text-sm text-neutral-500 hover:underline">
          Reset
        </button>
      )}
      <span
        className={`pb-1.5 text-xs text-neutral-400 transition-opacity ${
          isPending ? "opacity-100" : "opacity-0"
        }`}
      >
        Updating…
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-neutral-500">{label}</span>
      {children}
    </label>
  );
}
