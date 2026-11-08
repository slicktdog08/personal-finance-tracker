"use client";

import { useState, useTransition } from "react";
import { toNum } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import { GOAL_TYPES, GOAL_STATUSES, GOAL_TYPE_META, type GoalType } from "@/constants/enums";
import { updateGoal, deleteGoal, addContribution, deleteContribution } from "@/server/actions/goals";
import { EmojiPicker } from "@/components/EmojiPicker";
import { acctSelectOptions, type AcctOption } from "@/components/goals/AddGoal";
import type { GoalProgressRow } from "@/server/queries";
import type { GoalContribution } from "@/server/db/schema";
import { Badge, Button, Card, DataTable, Field, Glyph, IconButton, Input, Money, Notice, ProgressBar, Select, cx } from "@/components/ds";
import { Sheet } from "@/components/ui/Sheet";

const num = (s: string) => {
  const n = Number(s.replace(/[$,%\s]/g, ""));
  return s.trim() === "" || Number.isNaN(n) ? null : n;
};
const STATUS_LABEL: Record<string, string> = { active: "Active", achieved: "Achieved", archived: "Archived" };

export function GoalCard({ goal, contributions, accounts }: { goal: GoalProgressRow; contributions: GoalContribution[]; accounts: AcctOption[] }) {
  const [pending, start] = useTransition();
  const [moving, setMoving] = useState<1 | -1 | null>(null);
  const [editing, setEditing] = useState(false);

  const target = goal.targetAmount;
  const funded = goal.funded;
  const pct = target > 0 ? (funded / target) * 100 : 0;
  const achieved = target > 0 && funded >= target;
  const remaining = Math.max(0, target - funded);
  const acctName = goal.fundingAccountLabel ?? (goal.fundingAccountNumber ? `••${goal.fundingAccountNumber}` : null);
  const archived = goal.status === "archived";
  const meta = GOAL_TYPE_META[goal.goalType as GoalType];

  // The day the running total first reached the target (ledger is newest first).
  let reachedOn: string | null = null;
  if (achieved) {
    let run = 0;
    for (const c of [...contributions].reverse()) {
      run += toNum(c.amount) ?? 0;
      if (run >= target) {
        reachedOn = c.occurredOn;
        break;
      }
    }
  }

  return (
    <Card className={cx(archived && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Glyph color={goal.color} size="lg">
            <span className="text-lg leading-none">{goal.emoji ?? meta?.emoji}</span>
          </Glyph>
          <div className="min-w-0">
            <div className="font-display text-lg font-semibold leading-tight">{goal.name}</div>
            <div className="text-[13px] text-fg-3">
              {meta?.label ?? goal.goalType}
              {acctName ? ` · funded from ${acctName}` : " · no funding account"}
              {goal.status !== "active" && ` · ${STATUS_LABEL[goal.status] ?? goal.status}`}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {achieved && <Badge label="Reached" color="var(--mp-money-income)" icon="check" />}
          <Button size="sm" variant="secondary" icon="plus" onClick={() => setMoving(1)}>
            Fund
          </Button>
          <Button size="sm" variant="ghost" icon="minus" onClick={() => setMoving(-1)}>
            Withdraw
          </Button>
          <IconButton size="sm" icon="settings" label="Edit goal" onClick={() => setEditing(true)} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-2">
        <Money value={funded} kind="neutral" style={{ font: "var(--mp-type-money-lg)" }} />
        <span className="text-fg-3">
          of <Money value={target} kind="neutral" />
        </span>
        {!achieved && <span className="ml-auto text-sm font-semibold text-fg-2">{pct.toFixed(0)}%</span>}
      </div>
      {/* Two segments: what the funding account actually backs, then what it no longer covers. */}
      <ProgressBar
        size="lg"
        className="mt-2.5"
        max={target}
        label={`${goal.name} progress`}
        segments={[
          { value: Math.min(goal.backed, target), color: "var(--mp-money-income)" },
          ...(goal.shortfall > 0 ? [{ value: goal.shortfall, color: "var(--mp-money-over)" }] : []),
        ]}
        legendLeft={
          achieved ? (
            reachedOn ? `Target reached ${formatDate(reachedOn)}` : "Target reached"
          ) : (
            <>
              <Money value={remaining} kind="neutral" /> to go{goal.targetDate && ` · by ${formatDate(goal.targetDate)}`}
            </>
          )
        }
        legendRight={
          acctName && goal.accountBalance != null ? (
            <>
              {acctName} holds <Money value={goal.accountBalance} kind="neutral" />
            </>
          ) : acctName ? (
            `Backed by ${acctName}`
          ) : undefined
        }
      />

      {goal.shortfall > 0 && (
        <Notice
          tone="warn"
          className="mt-3.5"
          title={
            <>
              Short by <Money value={goal.shortfall} kind="neutral" />
            </>
          }
          action={
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Edit goal
            </Button>
          }
        >
          {acctName ?? "The funding account"} dipped below what this goal has set aside. Top it up, or lower the goal.
        </Notice>
      )}

      <div className="mt-4">
        <div className="mp-field__label mb-1">Contributions</div>
        <DataTable
          dense
          rows={contributions}
          empty={<p className="py-3 text-sm text-fg-3">No contributions yet. Fund it to start tracking progress.</p>}
          columns={[
            { key: "occurredOn", header: "Date", shrink: true, render: (c) => formatDate(c.occurredOn) },
            { key: "note", header: "Note", render: (c) => <span className="text-fg-2">{c.note || "—"}</span> },
            { key: "amount", header: "Amount", num: true, render: (c) => <Money value={toNum(c.amount)} kind={(toNum(c.amount) ?? 0) >= 0 ? "income" : "spend"} sign="always" /> },
            {
              key: "del",
              header: "",
              shrink: true,
              render: (c) => <IconButton size="sm" icon="trash-2" label="Delete contribution" disabled={pending} onClick={() => start(async () => { await deleteContribution(c.id); })} />,
            },
          ]}
          mobile={{
            title: (c) => formatDate(c.occurredOn),
            sub: (c) => c.note,
            amount: (c) => <Money value={toNum(c.amount)} kind={(toNum(c.amount) ?? 0) >= 0 ? "income" : "spend"} sign="always" />,
            meta: (c) => <IconButton size="sm" icon="trash-2" label="Delete contribution" disabled={pending} onClick={() => start(async () => { await deleteContribution(c.id); })} />,
          }}
        />
      </div>

      {moving != null && <MoveSheet goal={goal} sign={moving} onClose={() => setMoving(null)} />}
      {editing && <EditGoalSheet goal={goal} accounts={accounts} onClose={() => setEditing(false)} />}
    </Card>
  );
}

/** Fund (+) or withdraw (−) — one contribution row either way. */
function MoveSheet({ goal, sign, onClose }: { goal: GoalProgressRow; sign: 1 | -1; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [amt, setAmt] = useState("");
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const n = num(amt);
  const ok = n != null && n !== 0 && !!when;
  const save = () => {
    if (!ok) return;
    start(async () => {
      await addContribution(goal.id, sign * Math.abs(n!), when, note || null);
      onClose();
    });
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={sign > 0 ? `Fund ${goal.name}` : `Withdraw from ${goal.name}`}
      footer={
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={sign > 0 ? "plus" : "minus"} onClick={save} loading={pending} disabled={!ok}>
            {sign > 0 ? "Add to goal" : "Withdraw"}
          </Button>
        </div>
      }
    >
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Amount">
          <Input money autoFocus value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="500.00" />
        </Field>
        <Field label="Date">
          <Input type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/** Everything about the goal itself: icon, name, type, status, target, date, funding account, delete. */
function EditGoalSheet({ goal, accounts, onClose }: { goal: GoalProgressRow; accounts: AcctOption[]; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [emoji, setEmoji] = useState<string | null>(goal.emoji);
  const [name, setName] = useState(goal.name);
  const [goalType, setGoalType] = useState(goal.goalType);
  const [status, setStatus] = useState(goal.status);
  const [target, setTarget] = useState(String(goal.targetAmount));
  const [targetDate, setTargetDate] = useState(goal.targetDate ?? "");
  const [acct, setAcct] = useState(goal.fundingAccountId != null ? String(goal.fundingAccountId) : "");
  const [confirmDel, setConfirmDel] = useState(false);
  const save = () =>
    start(async () => {
      const patch: Parameters<typeof updateGoal>[1] = {};
      if (emoji !== goal.emoji) patch.emoji = emoji;
      if (name.trim() && name.trim() !== goal.name) patch.name = name.trim();
      if (goalType !== goal.goalType) patch.goalType = goalType;
      if (status !== goal.status) patch.status = status;
      const t = num(target);
      if (t != null && t > 0 && t !== goal.targetAmount) patch.targetAmount = t;
      if ((targetDate || null) !== goal.targetDate) patch.targetDate = targetDate || null;
      const a = acct ? Number(acct) : null;
      if (a !== goal.fundingAccountId) patch.fundingAccountId = a;
      if (Object.keys(patch).length) await updateGoal(goal.id, patch);
      onClose();
    });
  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit goal"
      footer={
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          {confirmDel ? (
            <span className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="danger"
                icon="trash-2"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    await deleteGoal(goal.id);
                    onClose();
                  })
                }
              >
                Delete goal
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>
                Keep
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" icon="trash-2" className="text-fg-3 hover:text-over" onClick={() => setConfirmDel(true)}>
              Delete
            </Button>
          )}
          <span className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} loading={pending}>
              Save changes
            </Button>
          </span>
        </div>
      }
    >
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Name" className="col-span-2">
          <div className="flex items-center gap-2">
            <EmojiPicker value={emoji ?? GOAL_TYPE_META[goalType as GoalType]?.emoji} onSelect={setEmoji} title="Pick an icon" />
            <Input value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1" />
          </div>
        </Field>
        <Field label="Type">
          <Select value={goalType} onChange={(e) => setGoalType(e.target.value)} options={GOAL_TYPES.map((t) => ({ value: t, label: GOAL_TYPE_META[t].label }))} />
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} options={GOAL_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] ?? s }))} />
        </Field>
        <Field label="Target">
          <Input money value={target} onChange={(e) => setTarget(e.target.value)} />
        </Field>
        <Field label="Target date">
          <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </Field>
        <Field label="Funding account" className="col-span-2">
          <Select value={acct} onChange={(e) => setAcct(e.target.value)} options={acctSelectOptions(accounts)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
