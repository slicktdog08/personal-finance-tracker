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
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  Glyph,
  Input,
  ListRow,
  Money,
  ProgressBar,
  Select,
  StatTile,
  type VarStyle,
} from "@/components/ds";

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
      if (!res.ok) {
        setError(res.error);
        router.refresh();
      }
      setPick((p) => ({ ...p, [spendId]: "" }));
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
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Month"
          value={selected}
          onChange={(e) => goMonth(e.target.value)}
          options={[{ value: "", label: "All months" }, ...periods.map((p) => ({ value: p.label, label: p.pretty }))]}
          className="!w-auto min-w-44"
        />
        <Button
          variant="secondary"
          icon="wand-sparkles"
          onClick={suggest}
          disabled={pending || !unfunded.length}
          title={
            unfunded.length
              ? "Match unfunded purchases to the withdrawals that could have paid for them"
              : "Every cash purchase in view is already accounted for"
          }
        >
          Suggest matches
        </Button>
        {error && <span className="text-sm text-over">{error}</span>}
      </div>

      {/* The month's arithmetic, in the order it reads: took out, minus the two things that
          explain it (bought something / still holding it), leaves what really went missing. */}
      <div className="mp-grid mp-grid--keep2" style={{ "--cols": 4 } as VarStyle}>
        <Card>
          <StatTile size="sm" label="Withdrawn" value={totals.withdrawn} sub="Cash pulled out this month" />
        </Card>
        <Card>
          <StatTile
            size="sm"
            label="Spent on logged purchases"
            value={totals.accounted}
            // `accounted` is what these withdrawals paid for — which can include purchases dated
            // next month — so it deliberately isn't the same figure as this month's wallet
            // spending. Both are shown rather than conflated.
            sub={
              totals.unfunded > 0
                ? `${formatMoney(totals.walletSpend)} of cash purchases logged this month, ${formatMoney(
                    totals.unfunded,
                  )} of it not tied to a withdrawal yet`
                : `${formatMoney(totals.walletSpend)} of cash purchases logged this month`
            }
          />
        </Card>
        {/* Swings both ways: cash kept is an asset, cash drawn down from an earlier month is
            spending with no transaction behind it. */}
        <Card>
          <StatTile
            size="sm"
            label={totals.held < 0 ? "Spent from earlier cash" : "Still in your pocket"}
            value={Math.abs(totals.held)}
            kind={totals.held < 0 ? "over" : "neutral"}
            sub={
              pocket.countedOn
                ? `Counted ${formatDate(pocket.countedOn)} — ${formatMoney(
                    pocket.closing,
                  )} on hand, ${formatMoney(pocket.opening)} carried in`
                : "Never counted — so all of it reads as spent"
            }
          />
        </Card>
        <Card>
          <StatTile
            size="sm"
            label="Unaccounted spending"
            value={totals.unaccountedSpend}
            kind={totals.unaccountedSpend > 0 ? "over" : "neutral"}
            sub="Gone, with nothing recorded to say where"
          />
        </Card>
      </div>

      {/* Spell the arithmetic out. The whole point of this screen is that these four numbers
          add up, so show them adding up rather than asking anyone to take it on faith. */}
      <p className="text-xs text-fg-3 tabular-nums">
        {formatMoney(totals.withdrawn)} withdrawn − {formatMoney(totals.accounted)} on logged
        purchases{" "}
        {totals.held < 0
          ? `+ ${formatMoney(Math.abs(totals.held))} spent from earlier cash`
          : `− ${formatMoney(totals.held)} still in your pocket`}{" "}
        = <strong className="text-fg">{formatMoney(totals.unaccountedSpend)}</strong> unaccounted.
      </p>

      <CountPocket wallet={wallet} pocket={pocket} monthEnd={selected} />

      {proposals && (
        <Card
          title={
            proposals.length
              ? `${proposals.length - skipped.size} match${proposals.length - skipped.size === 1 ? "" : "es"} to apply`
              : "No matches found"
          }
          action={
            <span className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setProposals(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                icon="check"
                onClick={applyAll}
                disabled={pending || proposals.length === skipped.size}
              >
                Apply
              </Button>
            </span>
          }
        >
          {proposals.length === 0 && (
            <p className="text-xs text-fg-2">
              Nothing lined up: every unfunded purchase is either older than its nearest
              withdrawal or more than {SUGGEST_WINDOW_DAYS} days after it — too far to guess at.
              Link those by hand below.
            </p>
          )}
          <ul className="space-y-1.5">
            {/* Mobile: spend and withdrawal stack on two lines — two truncating
                columns side-by-side leave neither readable at phone width. */}
            {proposals.map((p, i) => (
              <li key={`${p.withdrawalId}-${p.spendId}`} className="flex items-start gap-2 text-xs">
                <Checkbox
                  aria-label="Include this match"
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
                  <span className="min-w-0 truncate text-fg-2 sm:flex-1">
                    ← {formatDate(p.withdrawalDate)} · {p.withdrawalDescription}
                  </span>
                </div>
                <Money value={p.amount} kind="neutral" className="shrink-0 font-medium" />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mp-grid items-start" style={{ "--cols": 2 } as VarStyle}>
        {/* ---- Withdrawals ---- */}
        <Card title="Withdrawals" meta="where the cash came from">
          <p className="mb-1 text-xs text-fg-3">
            Cash sources in this month, plus any from the last {carryInDays} days that still hold
            money. Tap one to see what it paid for.
          </p>
          {withdrawals.length === 0 ? (
            <EmptyState
              compact
              icon="banknote"
              title="No cash withdrawals here"
              body="Rows become withdrawals when you categorize them as Cash."
            />
          ) : (
            <ul className="divide-y divide-line">
              {withdrawals.map((w) => {
                const isOpen = openId === w.id;
                return (
                  <li key={w.id} className="py-1">
                    <ListRow
                      onClick={() => setOpenId(isOpen ? null : w.id)}
                      lead={<Glyph icon="banknote" />}
                      title={w.description}
                      sub={`${formatDate(w.txnDate)}${w.accountLabel ? ` · ${w.accountLabel}` : ""}`}
                      end={<Money value={-w.amount} />}
                      endSub={
                        w.remaining > 0 ? (
                          <span className="text-over">{formatMoney(w.remaining)} unaccounted</span>
                        ) : (
                          "fully accounted for"
                        )
                      }
                    />
                    <ProgressBar
                      value={w.allocated}
                      max={w.amount || 1}
                      size="sm"
                      label="Share of this withdrawal matched to purchases"
                      legendLeft={`${formatMoney(w.allocated)} matched to purchases`}
                      legendRight={w.remaining > 0 ? `${formatMoney(w.remaining)} unaccounted` : undefined}
                      className="mb-1.5"
                    />
                    {isOpen && (
                      <div className="-mx-5 max-md:-mx-3.5 mb-1 border-y border-line">
                        <CashOffsetDetail withdrawalId={w.id} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* ---- Wallet purchases ---- */}
        <Card title="Cash purchases" meta="need a source">
          <p className="mb-1 text-xs text-fg-3">
            Spending logged on the wallet that isn&apos;t drawn from a withdrawal yet — right now
            it&apos;s counted on top of them.
          </p>
          {unfunded.length === 0 ? (
            <EmptyState
              compact
              icon="circle-check"
              title={spends.length ? "Every cash purchase is accounted for" : "No cash purchases logged"}
              body={spends.length ? "Todo al día." : "Nothing spent from the wallet this month."}
            />
          ) : (
            <ul className="divide-y divide-line">
              {unfunded.map((s) => {
                const options = open.filter((w) => canFund(w, s));
                return (
                  <li key={s.id} className="py-1 space-y-1.5">
                    <ListRow
                      lead={<Glyph icon="shopping-bag" />}
                      title={s.description}
                      sub={`${formatDate(s.txnDate)}${s.category ? ` · ${s.category}` : ""}`}
                      end={<Money value={-s.uncovered} />}
                      endSub={s.uncovered + 0.004 < s.amount ? `of ${formatMoney(s.amount)}` : undefined}
                    />
                    <div className="flex items-center gap-2 pb-1.5">
                      <Select
                        aria-label="Pay this from"
                        value={pick[s.id] ?? ""}
                        onChange={(e) => setPick((p) => ({ ...p, [s.id]: e.target.value }))}
                        disabled={!options.length}
                        options={[
                          {
                            value: "",
                            label: options.length ? "Pick a source" : "No withdrawal nearby still holds cash",
                          },
                          ...options.map((w) => ({
                            value: String(w.id),
                            label: `${formatDate(w.txnDate)} · ${w.description.slice(0, 20)} · ${formatMoney(w.remaining)} left`,
                          })),
                        ]}
                        className="!h-9 min-w-0 flex-1 !text-xs disabled:opacity-50"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => offset(s.id)}
                        disabled={pending || !pick[s.id]}
                        className="shrink-0"
                      >
                        Offset
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
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
    });
  }

  const stale = pocket.countedOn && monthEnd && pocket.countedOn < `${monthEnd}-01`;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {open ? (
        <>
          <span className="text-fg-2">I have</span>
          <Input
            aria-label="Cash on hand"
            money
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            autoFocus
            className="!h-9 !w-28"
          />
          <span className="text-fg-2">in cash as of</span>
          <Input
            aria-label="Counted on"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="!h-9 !w-auto"
          />
          <Button size="sm" icon="check" onClick={save} disabled={pending || amount === ""}>
            Save count
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" variant="secondary" icon="banknote" onClick={() => setOpen(true)}>
            Count my cash
          </Button>
          <span className="text-xs text-fg-3">
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
