"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, toNum } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import { GOAL_TYPES, GOAL_STATUSES, GOAL_TYPE_META } from "@/constants/enums";
import {
  updateGoal,
  deleteGoal,
  addContribution,
  deleteContribution,
} from "@/server/actions/goals";
import { EmojiPicker } from "@/components/EmojiPicker";
import { acctOptionLabel, type AcctOption } from "@/components/goals/AddGoal";
import type { GoalProgressRow } from "@/server/queries";
import type { GoalContribution } from "@/server/db/schema";

export function GoalCard({
  goal,
  contributions,
  accounts,
}: {
  goal: GoalProgressRow;
  contributions: GoalContribution[];
  accounts: AcctOption[];
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const refresh = () => router.refresh();
  const inputCls =
    "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";
  const num = (s: string) => {
    const n = Number(s.replace(/[$,%\s]/g, ""));
    return Number.isNaN(n) ? null : n;
  };

  const [amt, setAmt] = useState("");
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  const target = goal.targetAmount;
  const funded = goal.funded;
  const pct = target > 0 ? (funded / target) * 100 : 0;
  const achieved = target > 0 && funded >= target;
  const remaining = Math.max(0, target - funded);
  const backedPct = target > 0 ? Math.min(100, (goal.backed / target) * 100) : 0;
  const shortPct = target > 0 ? Math.min(100 - backedPct, (goal.shortfall / target) * 100) : 0;
  const acctName =
    goal.fundingAccountLabel ?? (goal.fundingAccountNumber ? `••${goal.fundingAccountNumber}` : null);
  const archived = goal.status === "archived";

  function saveField(patch: Parameters<typeof updateGoal>[1]) {
    start(async () => {
      await updateGoal(goal.id, patch);
      refresh();
    });
  }
  function fund(sign: 1 | -1) {
    const n = num(amt);
    if (n == null || n === 0 || !when) return;
    start(async () => {
      await addContribution(goal.id, sign * Math.abs(n), when, note || null);
      setAmt("");
      setNote("");
      refresh();
    });
  }

  return (
    <div
      className={`rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3 ${
        archived ? "opacity-60" : ""
      }`}
    >
      {/* Header — inline-editable identity */}
      <div className="flex flex-wrap items-center gap-2">
        <EmojiPicker value={goal.emoji} onSelect={(e) => saveField({ emoji: e })} />
        <input
          defaultValue={goal.name}
          onBlur={(e) =>
            e.target.value.trim() && e.target.value !== goal.name && saveField({ name: e.target.value })
          }
          className={inputCls + " flex-1 min-w-40 font-semibold"}
        />
        <select
          value={goal.goalType}
          onChange={(e) => saveField({ goalType: e.target.value })}
          className={inputCls}
        >
          {GOAL_TYPES.map((t) => (
            <option key={t} value={t}>
              {GOAL_TYPE_META[t].label}
            </option>
          ))}
        </select>
        <select
          value={goal.status}
          onChange={(e) => saveField({ status: e.target.value })}
          className={inputCls}
          title="Status"
        >
          {GOAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {!confirmDel ? (
          <button
            onClick={() => setConfirmDel(true)}
            className="text-xs text-neutral-400 hover:text-red-600"
            title="Delete goal"
          >
            ✕
          </button>
        ) : (
          <span className="text-xs flex items-center gap-1">
            <button
              onClick={() =>
                start(async () => {
                  await deleteGoal(goal.id);
                  refresh();
                })
              }
              className="text-red-600 hover:underline"
            >
              delete?
            </button>
            <button onClick={() => setConfirmDel(false)} className="text-neutral-500 hover:underline">
              no
            </button>
          </span>
        )}
      </div>

      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-lg font-semibold tabular-nums">
            {formatMoney(funded)}{" "}
            <span className="text-sm font-normal text-neutral-500">of {formatMoney(target)}</span>
          </div>
          <div className={`text-sm font-semibold tabular-nums ${achieved ? "text-emerald-600" : ""}`}>
            {achieved ? "✔ reached" : `${pct.toFixed(0)}%`}
          </div>
        </div>
        <div className="h-2.5 w-full flex overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
          <div
            className="h-full"
            style={{
              width: `${Math.max(funded > 0 ? 2 : 0, backedPct)}%`,
              backgroundColor: achieved ? "#10b981" : goal.color,
            }}
          />
          {shortPct > 0 && <div className="h-full bg-red-400/80" style={{ width: `${shortPct}%` }} />}
        </div>
        <div className="flex flex-wrap justify-between gap-x-3 text-xs text-neutral-500">
          <span>
            {remaining > 0 ? `${formatMoney(remaining)} to go` : "Target reached"}
            {goal.targetDate && ` · by ${formatDate(goal.targetDate)}`}
          </span>
          {goal.shortfall > 0 ? (
            <span className="text-red-600 dark:text-red-400 font-medium">
              ⚠ Under-funded by {formatMoney(goal.shortfall)}
              {acctName && ` — ${acctName} has ${formatMoney(goal.accountBalance)}`}
            </span>
          ) : acctName ? (
            <span>
              Backed by {acctName}
              {goal.accountBalance != null && ` · ${formatMoney(goal.accountBalance)} on hand`}
            </span>
          ) : null}
        </div>
      </div>

      {/* Editable details */}
      <div className="flex flex-wrap items-end gap-2 border-t border-neutral-100 dark:border-neutral-800 pt-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-neutral-500">Target</label>
          <input
            defaultValue={String(target)}
            inputMode="decimal"
            onBlur={(e) => {
              const v = num(e.target.value);
              if (v != null && v > 0 && v !== target) saveField({ targetAmount: v });
            }}
            className={inputCls + " w-28"}
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-neutral-500">Target date</label>
          <input
            type="date"
            defaultValue={goal.targetDate ?? ""}
            onBlur={(e) => {
              const v = e.target.value || null;
              if (v !== goal.targetDate) saveField({ targetDate: v });
            }}
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-neutral-500">
            Funding account
          </label>
          <select
            value={goal.fundingAccountId != null ? String(goal.fundingAccountId) : ""}
            onChange={(e) => saveField({ fundingAccountId: e.target.value ? Number(e.target.value) : null })}
            className={inputCls + " max-w-52"}
          >
            <option value="">— none —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {acctOptionLabel(a)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Funding ledger */}
      <div className="rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-neutral-500">Amount</label>
            <input
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
              placeholder="500"
              inputMode="decimal"
              className={inputCls + " w-24"}
            />
          </div>
          <input type="date" value={when} onChange={(e) => setWhen(e.target.value)} className={inputCls} />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="note (optional)"
            className={inputCls + " flex-1 min-w-32"}
          />
          <button
            onClick={() => fund(1)}
            disabled={pending || !amt.trim()}
            className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            + Fund
          </button>
          <button
            onClick={() => fund(-1)}
            disabled={pending || !amt.trim()}
            className="px-3 py-1.5 rounded-md bg-neutral-200 dark:bg-neutral-700 text-sm font-medium hover:bg-neutral-300 dark:hover:bg-neutral-600 disabled:opacity-50"
          >
            − Withdraw
          </button>
        </div>

        {contributions.length > 0 ? (
          <div className="max-h-48 overflow-y-auto overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {contributions.map((c) => {
                  const a = toNum(c.amount) ?? 0;
                  const pos = a >= 0;
                  return (
                    <tr key={c.id} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="py-1 tabular-nums">{formatDate(c.occurredOn)}</td>
                      <td
                        className={`py-1 text-right tabular-nums font-medium ${
                          pos ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {pos ? "+" : "−"}
                        {formatMoney(Math.abs(a))}
                      </td>
                      <td className="py-1 pl-3 text-neutral-500 truncate max-w-48">{c.note ?? ""}</td>
                      <td className="py-1 text-right">
                        <button
                          onClick={() =>
                            start(async () => {
                              await deleteContribution(c.id);
                              refresh();
                            })
                          }
                          className="text-xs text-red-600 hover:underline"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-neutral-500">No contributions yet. Fund it above to start tracking progress.</p>
        )}
      </div>
    </div>
  );
}
