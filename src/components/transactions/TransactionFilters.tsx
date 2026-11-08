"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, FilterBar, Select } from "@/components/ds";
import { FilterMultiSelect } from "@/components/transactions/FilterMultiSelect";
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

type ChipId = "uncat" | "pending" | "bill";

export function TransactionFilters({
  periods,
  accounts,
  categoryOptions,
  initial,
  counts,
}: {
  periods: { label: string; pretty?: string }[];
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
    /** Only rows linked to a bill (?bill=1). */
    billLinked?: boolean;
  };
  /** How many rows each chip would leave, given the other filters. Omitted counts hide. */
  counts?: { uncategorized?: number; pending?: number; billLinked?: number };
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
  const [billLinked, setBillLinked] = useState(!!initial.billLinked);

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
      if (billLinked) next.set("bill", "1");
      else next.delete("bill");
      next.delete("page"); // any filter change returns to page 1
      startTransition(() => router.replace(`/transactions?${next.toString()}`, { scroll: false }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [periodLabels, accountIds, categories, direction, search, uncategorized, pendingOnly, billLinked, router]);

  const hasFilters =
    periodLabels.length > 0 ||
    accountIds.length > 0 ||
    categories.length > 0 ||
    direction !== "" ||
    search !== "" ||
    uncategorized ||
    pendingOnly ||
    billLinked;

  function reset() {
    setPeriodLabels([]);
    setAccountIds([]);
    setCategories([]);
    setDirection("");
    setSearch("");
    setUncategorized(false);
    setPendingOnly(false);
    setBillLinked(false);
  }

  const active: ChipId[] = [
    ...(uncategorized ? (["uncat"] as const) : []),
    ...(pendingOnly ? (["pending"] as const) : []),
    ...(billLinked ? (["bill"] as const) : []),
  ];
  function onToggle(id: string) {
    if (id === "uncat") setUncategorized((v) => !v);
    else if (id === "pending") setPendingOnly((v) => !v);
    else if (id === "bill") setBillLinked((v) => !v);
  }

  // Selects share the row with search on desktop; under the FilterBar's 560px container
  // breakpoint the search takes the full row and these wrap two-up beneath it.
  const sel = "!w-auto min-w-0 flex-1 basis-[calc(50%-8px)] sm:flex-none sm:basis-auto sm:!w-40";

  return (
    <div className="space-y-2">
      <FilterBar
        search={search}
        onSearch={setSearch}
        placeholder="Search description, note, amount"
        chips={[
          { id: "uncat", label: "Uncategorized", count: counts?.uncategorized },
          { id: "pending", label: "Pending", count: counts?.pending },
          { id: "bill", label: "Linked to a bill", count: counts?.billLinked },
        ]}
        active={active}
        onToggle={onToggle}
      >
        <FilterMultiSelect
          label="Month"
          allLabel="All months"
          noun="months"
          value={periodLabels}
          onChange={setPeriodLabels}
          options={periods.map((p) => ({ value: p.label, label: p.pretty ?? p.label }))}
          className={sel}
        />
        <FilterMultiSelect
          label="Account"
          allLabel="All accounts"
          noun="accounts"
          value={accountIds}
          onChange={setAccountIds}
          options={accounts.map((a) => ({
            value: String(a.id),
            label: a.label ? `${a.label} (${a.accountNumber})` : a.accountNumber,
          }))}
          className={sel}
        />
        <FilterMultiSelect
          label="Category"
          allLabel="All categories"
          noun="categories"
          value={categories}
          onChange={setCategories}
          options={categoryOptions.map((c) => ({
            value: c.name,
            label: `${c.emoji ? `${c.emoji} ` : ""}${c.name}`,
          }))}
          className={sel}
        />
        <Select
          aria-label="Direction"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          options={[
            { value: "", label: "In and out" },
            { value: "Debit", label: "Money out" },
            { value: "Credit", label: "Money in" },
          ]}
          className={sel}
        />
      </FilterBar>
      {(hasFilters || isPending) && (
        <div className="flex items-center gap-2 text-xs text-fg-3">
          {hasFilters && (
            <Button size="sm" variant="ghost" icon="x" onClick={reset}>
              Clear filters
            </Button>
          )}
          <span className={`transition-opacity ${isPending ? "opacity-100" : "opacity-0"}`} aria-live="polite">
            Updating…
          </span>
        </div>
      )}
    </div>
  );
}
