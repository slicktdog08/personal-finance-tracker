"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CashOffsetDetail } from "@/components/transactions/CashOffsetDetail";
import {
  allocateCash,
  applyProposals,
  suggestCashAllocations,
  type ProposalPreview,
} from "@/server/actions/cash";
import { addAccountBalance } from "@/server/actions/accounts";
import { canFund, SUGGEST_WINDOW_DAYS } from "@/server/lib/cash";
import { todayIso } from "@/server/lib/pay-schedule";
import { formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import type { CashHeld, CashOverview } from "@/server/queries";

/**
 * The month's cash, both halves side by side: withdrawals that still hold unexplained money,
 * and wallet purchases that aren't drawn from any withdrawal yet. Linking one to the other is
 * the whole job, so both lists shrink as you work.
 */
export function CashManager({
  overview,
  periods,
  selected,
  wallet,
}: {
  overview: CashOverview;
  periods: { label: string; pretty: string }[];
  selected: string;
  /** The wallet account a pocket count is recorded against. */
  wallet: { id: number; label: string | null; accountNumber: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openId, setOpenId] = useState<number | null>(null);
  const [pick, setPick] = useState<Record<number, string>>({});
  const [proposals, setProposals] = useState<ProposalPreview[] | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");

  const { withdrawals, spends, totals, pocket, carryInDays } = overview;
  const open = withdrawals.filter((w) => w.remaining > 0);
  const unfunded = spends.filter((s) => s.uncovered > 0);

  function goMonth(label: string) {
    router.push(label ? `/cash?period=${encodeURIComponent(label)}` : "/cash?period=");
  }

  // Link one purchase to the withdrawal chosen beside it.
  function offset(spendId: number) {
    const wid = Number(pick[spendId]);
    if (!wid) return;
    setError("");
    start(async () => {
      const res = await allocateCash(wid, spendId);
      if (!res.ok) setError(res.error);
      setPick((p) => ({ ...p, [spendId]: "" }));
      router.refresh();
    });
  }

  function suggest() {
    setError("");
    start(async () => {
      const found = await suggestCashAllocations(selected || undefined);
      setProposals(found);
      setSkipped(new Set());
    });
  }

  function applyAll() {
    if (!proposals) return;
    const keep = proposals.filter((_, i) => !skipped.has(i));
    start(async () => {
      const res = await applyProposals(
        keep.map((p) => ({
          withdrawalId: p.withdrawalId,
          spendId: p.spendId,
          amount: p.amount,
        })),
      );
      setProposals(null);
      setError(
        res.skipped > 0
          ? `Linked ${res.applied}; ${res.skipped} couldn't be applied. ${res.errors.join(" ")}`
          : "",
      );
      router.refresh();
    });
  }

  const card =
    "rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selected}
          onChange={(e) => goMonth(e.target.value)}
          className="border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700"
        >
          <option value="">All months</option>
          {periods.map((p) => (
            <option key={p.label} value={p.label}>
              {p.pretty}
            </option>
          ))}
        </select>
        <button
          onClick={suggest}
          disabled={pending || !unfunded.length}
          className="px-3 py-1.5 rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-sm font-medium disabled:opacity-40"
          title={
            unfunded.length
              ? "Match unfunded purchases to the withdrawals that could have paid for them"
              : "Every cash purchase in view is already accounted for"
          }
        >
          Suggest matches
        </button>
        {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
      </div>

      {/* The month's arithmetic, in the order it reads: took out, minus the two things that
          explain it (bought something / still holding it), leaves what really went missing. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Withdrawn" value={totals.withdrawn} hint="Cash pulled out this month" />
        <Stat
          label="Spent on logged purchases"
          value={totals.accounted}
          // `accounted` is what these withdrawals paid for — which can include purchases dated
          // next month — so it deliberately isn't the same figure as this month's wallet
          // spending. Both are shown rather than conflated.
          hint={
            totals.unfunded > 0
              ? `${formatMoney(totals.walletSpend)} of cash purchases logged this month, ${formatMoney(
                  totals.unfunded,
                )} of it not tied to a withdrawal yet`
              : `${formatMoney(totals.walletSpend)} of cash purchases logged this month`
          }
          tone="good"
        />
        {/* Swings both ways: cash kept is an asset, cash drawn down from an earlier month is
            spending with no transaction behind it. */}
        <Stat
          label={totals.held < 0 ? "Spent from earlier cash" : "Still in your pocket"}
          value={Math.abs(totals.held)}
          hint={
            pocket.countedOn
              ? `Counted ${formatDate(pocket.countedOn)} — ${formatMoney(
                  pocket.closing,
                )} on hand, ${formatMoney(pocket.opening)} carried in`
              : "Never counted — so all of it reads as spent"
          }
          tone={totals.held < 0 ? "bad" : "good"}
        />
        <Stat
          label="Unaccounted spending"
          value={totals.unaccountedSpend}
          hint="Gone, with nothing recorded to say where"
          tone={totals.unaccountedSpend > 0 ? "bad" : "good"}
        />
      </div>

      {/* Spell the arithmetic out. The whole point of this screen is that these four numbers
          add up, so show them adding up rather than asking anyone to take it on faith. */}
      <p className="text-xs text-neutral-500 tabular-nums">
        {formatMoney(totals.withdrawn)} withdrawn − {formatMoney(totals.accounted)} on logged
        purchases{" "}
        {totals.held < 0
          ? `+ ${formatMoney(Math.abs(totals.held))} spent from earlier cash`
          : `− ${formatMoney(totals.held)} still in your pocket`}{" "}
        = <strong>{formatMoney(totals.unaccountedSpend)}</strong> unaccounted.
      </p>

      <CountPocket wallet={wallet} pocket={pocket} monthEnd={selected} />

      {proposals && (
        <div className="rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">
              {proposals.length
                ? `${proposals.length - skipped.size} match${
                    proposals.length - skipped.size === 1 ? "" : "es"
                  } to apply`
                : "No matches found"}
            </span>
            <span className="flex items-center gap-2">
              <button
                onClick={() => setProposals(null)}
                className="text-sm text-neutral-500 hover:underline"
              >
                Cancel
              </button>
              <button
                onClick={applyAll}
                disabled={pending || proposals.length === skipped.size}
                className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                Apply
              </button>
            </span>
          </div>
          {proposals.length === 0 && (
            <p className="text-xs text-neutral-600 dark:text-neutral-300">
              Nothing lined up: every unfunded purchase is either older than its nearest
              withdrawal or more than {SUGGEST_WINDOW_DAYS} days after it — too far to guess at.
              Link those by hand below.
            </p>
          )}
          <ul className="space-y-1">
            {/* Mobile: spend and withdrawal stack on two lines — two truncating
                columns side-by-side leave neither readable at phone width. */}
            {proposals.map((p, i) => (
              <li key={`${p.withdrawalId}-${p.spendId}`} className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!skipped.has(i)}
                  onChange={() =>
                    setSkipped((prev) => {
                      const n = new Set(prev);
                      if (n.has(i)) n.delete(i);
                      else n.add(i);
                      return n;
                    })
                  }
                />
                <div className="flex-1 min-w-0 flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                  <span className="min-w-0 truncate sm:flex-1">
                    {formatDate(p.spendDate)} · {p.spendDescription}
                    {p.spendCategory ? ` (${p.spendCategory})` : ""}
                  </span>
                  <span className="min-w-0 truncate text-neutral-600 dark:text-neutral-300 sm:flex-1">
                    ← {formatDate(p.withdrawalDate)} · {p.withdrawalDescription}
                  </span>
                </div>
                <span className="shrink-0 tabular-nums font-medium">{formatMoney(p.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        {/* ---- Withdrawals ---- */}
        <section className={card}>
          <header className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800">
            <h2 className="font-semibold">Withdrawals</h2>
            <p className="text-xs text-neutral-500">
              Cash sources in this month, plus any from the last {carryInDays} days that still
              hold money.
            </p>
          </header>
          {withdrawals.length === 0 ? (
            <p className="px-3 py-6 text-sm text-neutral-500">
              No cash withdrawals here. Rows become withdrawals when you categorize them as
              Cash.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {withdrawals.map((w) => {
                const pct = w.amount > 0 ? Math.min(100, (w.allocated / w.amount) * 100) : 0;
                const isOpen = openId === w.id;
                return (
                  <li key={w.id}>
                    <button
                      onClick={() => setOpenId(isOpen ? null : w.id)}
                      className="w-full text-left px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-neutral-500 tabular-nums shrink-0">
                          {formatDate(w.txnDate)}
                        </span>
                        <span className="flex-1 min-w-0 truncate text-sm">{w.description}</span>
                        <span className="shrink-0 text-sm tabular-nums font-medium">
                          {formatMoney(w.amount)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="h-1.5 flex-1 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                          <span
                            className="block h-full bg-emerald-500"
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span
                          className={`text-[11px] tabular-nums shrink-0 ${
                            w.remaining > 0
                              ? "text-red-600 dark:text-red-400"
                              : "text-emerald-700 dark:text-emerald-400"
                          }`}
                        >
                          {w.remaining > 0
                            ? `${formatMoney(w.remaining)} unaccounted`
                            : "fully accounted for"}
                        </span>
                      </div>
                    </button>
                    {isOpen && <CashOffsetDetail withdrawalId={w.id} />}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ---- Wallet purchases ---- */}
        <section className={card}>
          <header className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800">
            <h2 className="font-semibold">Cash purchases needing a source</h2>
            <p className="text-xs text-neutral-500">
              Spending logged on the wallet that isn&apos;t drawn from a withdrawal yet — right
              now it&apos;s counted on top of them.
            </p>
          </header>
          {unfunded.length === 0 ? (
            <p className="px-3 py-6 text-sm text-neutral-500">
              {spends.length
                ? "Every cash purchase in this month is accounted for. 🎉"
                : "No cash purchases logged for this month."}
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {unfunded.map((s) => {
                const options = open.filter((w) => canFund(w, s));
                return (
                  <li key={s.id} className="px-3 py-2.5 space-y-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="flex-1 min-w-0 truncate text-sm">{s.description}</span>
                      <span className="shrink-0 text-sm tabular-nums font-medium">
                        {formatMoney(s.uncovered)}
                      </span>
                    </div>
                    <div className="text-xs text-neutral-500 tabular-nums truncate">
                      {formatDate(s.txnDate)}
                      {s.category ? ` · ${s.category}` : ""}
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={pick[s.id] ?? ""}
                        onChange={(e) => setPick((p) => ({ ...p, [s.id]: e.target.value }))}
                        disabled={!options.length}
                        className="flex-1 min-w-0 border rounded px-2 py-1.5 text-xs bg-transparent border-neutral-300 dark:border-neutral-700 disabled:opacity-50"
                      >
                        <option value="">
                          {options.length
                            ? "— pay this from —"
                            : "— no withdrawal nearby still holds cash —"}
                        </option>
                        {options.map((w) => (
                          <option key={w.id} value={String(w.id)}>
                            {formatDate(w.txnDate)} · {w.description.slice(0, 20)} ·{" "}
                            {formatMoney(w.remaining)} left
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => offset(s.id)}
                        disabled={pending || !pick[s.id]}
                        className="shrink-0 px-3 py-1.5 rounded bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
                      >
                        Offset
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: "good" | "bad";
}) {
  const color =
    tone === "bad"
      ? "text-red-600 dark:text-red-400"
      : tone === "good"
        ? "text-emerald-700 dark:text-emerald-400"
        : "";
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${color}`}>{formatMoney(value)}</div>
      <div className="text-[11px] text-neutral-400 leading-snug mt-0.5">{hint}</div>
    </div>
  );
}

/**
 * Record what's actually in your pocket. This is the only input that can tell withdrawn-but-
 * unspent cash apart from cash that quietly disappeared — nothing in the bank feed knows — so
 * it sits right under the totals it moves.
 *
 * The count is an ordinary `account_balances` snapshot on the wallet, the same dated-ledger
 * every other account uses; it is never derived, because a derived pocket balance would just
 * be the app telling itself what it already assumed.
 */
function CountPocket({
  wallet,
  pocket,
  monthEnd,
}: {
  wallet: { id: number; label: string | null; accountNumber: string };
  pocket: CashHeld;
  monthEnd: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());

  function save() {
    const n = Number(amount.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0 || !date) return;
    start(async () => {
      await addAccountBalance(wallet.id, n, date, "Counted");
      setOpen(false);
      setAmount("");
      router.refresh();
    });
  }

  const stale = pocket.countedOn && monthEnd && pocket.countedOn < `${monthEnd}-01`;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {open ? (
        <>
          <span className="text-neutral-500">I have</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            autoFocus
            className="w-24 border rounded px-2 py-1 text-sm text-right bg-transparent border-neutral-300 dark:border-neutral-700"
          />
          <span className="text-neutral-500">in cash as of</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700"
          />
          <button
            onClick={save}
            disabled={pending || amount === ""}
            className="px-3 py-1 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            Save count
          </button>
          <button onClick={() => setOpen(false)} className="text-neutral-500 hover:underline">
            Cancel
          </button>
        </>
      ) : (
        <>
          <button
            onClick={() => setOpen(true)}
            className="px-3 py-1.5 rounded-md border border-emerald-400 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 text-sm font-medium hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
          >
            💵 Count my cash
          </button>
          <span className="text-xs text-neutral-500">
            {pocket.countedOn ? (
              <>
                Last counted {formatDate(pocket.countedOn)} at {formatMoney(pocket.closing)}
                {stale ? " — before this month, so none of this month's cash is held" : ""}.
              </>
            ) : (
              <>Never counted — every dollar withdrawn reads as spent until you do.</>
            )}
          </span>
        </>
      )}
    </div>
  );
}
