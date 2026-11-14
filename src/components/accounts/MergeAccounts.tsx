"use client";

import { useState, useTransition } from "react";
import { mergeAccount, previewAccountMerge } from "@/server/actions/accounts";
import type { MergePlan } from "@/server/lib/account-merge";
import { Button, Field, Notice, Select, Sheet } from "@/components/ds";

export interface MergeChoice {
  id: number;
  name: string;
  accountNumber: string;
  accountType: string | null;
}

// "Card A ··1234" — or just "··1234" for an account with no name of its own.
const withNumber = (name: string, accountNumber: string) => (name.startsWith("··") ? name : `${name} ··${accountNumber.slice(-4)}`);

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// What moves, as short phrases — only the kinds the account going away actually has.
function moved(p: MergePlan): string[] {
  return [
    p.transactions ? plural(p.transactions, "transaction") : null,
    p.balances ? plural(p.balances, "balance snapshot") : null,
    p.trades ? plural(p.trades, "trade") : null,
    p.positions ? plural(p.positions, "holdings row") : null,
    p.rules ? plural(p.rules, "category rule") : null,
    p.goals ? plural(p.goals, "savings goal") : null,
    p.budgetLines ? plural(p.budgetLines, "budget line") : null,
    p.sync === "moves" ? "its bank-sync feed" : null,
    p.bill === "moves" ? "its bill link" : null,
  ].filter((s): s is string => s != null);
}

/**
 * Fold one account into another — for a card that was reissued with a new number and now shows
 * up twice. The server works out what would move first; nothing changes until it is confirmed.
 */
export function MergeAccounts({ accounts }: { accounts: MergeChoice[] }) {
  const [open, setOpen] = useState(false);
  const [intoId, setIntoId] = useState("");
  const [fromId, setFromId] = useState("");
  const [plan, setPlan] = useState<MergePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [merging, startMerge] = useTransition();

  if (accounts.length < 2) return null;

  const reset = () => {
    setIntoId("");
    setFromId("");
    setPlan(null);
    setError(null);
  };
  const close = () => {
    setOpen(false);
    reset();
  };

  // Re-plan whenever either side changes; a half-made choice clears the plan.
  const choose = (into: string, from: string) => {
    setIntoId(into);
    setFromId(from);
    setPlan(null);
    setError(null);
    if (!into || !from) return;
    startLoad(async () => {
      const res = await previewAccountMerge(Number(from), Number(into));
      if (res.ok) setPlan(res.plan);
      else setError(res.error);
    });
  };

  const merge = () =>
    startMerge(async () => {
      const res = await mergeAccount(Number(fromId), Number(intoId));
      if (res.ok) close();
      else setError(res.error);
    });

  const option = (a: MergeChoice) => ({
    value: String(a.id),
    label: `${withNumber(a.name, a.accountNumber)}${a.accountType ? ` (${a.accountType})` : ""}`,
  });
  const items = plan ? moved(plan) : [];
  const ready = plan != null && !plan.blocked && !loading;

  return (
    <>
      <Button variant="ghost" icon="merge" onClick={() => setOpen(true)}>
        Merge
      </Button>
      <Sheet
        open={open}
        onClose={close}
        title="Merge accounts"
        desktop="centered"
        width={460}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" icon="merge" onClick={merge} loading={merging} disabled={!ready || merging}>
              Merge accounts
            </Button>
          </div>
        }
      >
        <div className="grid gap-3">
          <p className="text-sm text-fg-2">
            For an account that shows up twice because its number changed, such as a reissued card. The history is
            combined under the account you keep.
          </p>
          <Field label="Keep" htmlFor="merge-into" hint="Usually the account with the current number.">
            <Select
              id="merge-into"
              value={intoId}
              onChange={(e) => choose(e.target.value, e.target.value === fromId ? "" : fromId)}
              options={[{ value: "", label: "Choose…" }, ...accounts.map(option)]}
            />
          </Field>
          <Field label="Merge in, then remove" htmlFor="merge-from">
            <Select
              id="merge-from"
              value={fromId}
              onChange={(e) => choose(intoId, e.target.value)}
              options={[{ value: "", label: "Choose…" }, ...accounts.filter((a) => String(a.id) !== intoId).map(option)]}
            />
          </Field>

          {loading && <p className="text-sm text-fg-3">Checking what would move…</p>}
          {error && <Notice tone="danger">{error}</Notice>}
          {plan?.blocked && <Notice tone="danger">{plan.blocked}</Notice>}

          {plan && !plan.blocked && (
            <>
              <div className="rounded-panel bg-sunken p-3 text-sm">
                <div className="font-medium">
                  {withNumber(plan.from.name, plan.from.accountNumber)} → {withNumber(plan.into.name, plan.into.accountNumber)}
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-fg-2">
                  <li>{items.length ? `Moves ${items.join(", ")}.` : "It has no history to move."}</li>
                  <li>
                    Statements that still say ··{plan.from.accountNumber.slice(-4)} will import into {plan.into.name}.
                  </li>
                  <li>
                    {withNumber(plan.from.name, plan.from.accountNumber)} is removed from your accounts.
                  </li>
                </ul>
              </div>
              {plan.warnings.map((w) => (
                <Notice key={w} tone="warn">
                  {w}
                </Notice>
              ))}
              <p className="text-xs text-fg-3">This can&apos;t be undone.</p>
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}
