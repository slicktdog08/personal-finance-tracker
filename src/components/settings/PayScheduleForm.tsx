"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePaySchedule, clearPaySchedule } from "@/server/actions/pay-schedule";
import {
  PAY_FREQUENCIES,
  PAY_FREQUENCY_META,
  type PayFrequency,
} from "@/constants/enums";
import { payCountdown, countdownLabel, paychecksPerYear } from "@/server/lib/pay-schedule";
import { formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/period";
import { DEFAULT_DEPOSIT_MATCH, DEFAULT_DEPOSIT_WINDOW_DAYS } from "@/server/lib/payday-reconcile";

const inputCls =
  "border rounded px-2 py-1 text-sm bg-transparent border-neutral-300 dark:border-neutral-700";

export interface PayScheduleFormProps {
  initial: {
    frequency: PayFrequency;
    dayOne: number | null;
    dayTwo: number | null;
    anchorDate: string | null;
    takeHome: number | null;
    depositWindowDays: number;
    depositMatch: string | null;
  } | null;
  /** Today from the server, so the live preview matches what the dashboard will show. */
  today: string;
}

export function PayScheduleForm({ initial, today }: PayScheduleFormProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [frequency, setFrequency] = useState<PayFrequency>(initial?.frequency ?? "semimonthly");
  const [dayOne, setDayOne] = useState(initial?.dayOne != null ? String(initial.dayOne) : "7");
  const [dayTwo, setDayTwo] = useState(initial?.dayTwo != null ? String(initial.dayTwo) : "22");
  const [anchorDate, setAnchorDate] = useState(initial?.anchorDate ?? "");
  const [takeHome, setTakeHome] = useState(
    initial?.takeHome != null ? String(initial.takeHome) : "",
  );
  const [windowDays, setWindowDays] = useState(String(initial?.depositWindowDays ?? DEFAULT_DEPOSIT_WINDOW_DAYS));
  const [depositMatch, setDepositMatch] = useState(initial?.depositMatch ?? "");

  const meta = PAY_FREQUENCY_META[frequency];
  const num = (s: string) => {
    const n = Number(s.replace(/[$,\s]/g, ""));
    return s.trim() === "" || Number.isNaN(n) ? null : n;
  };

  // Live preview off the same pure helper the dashboard uses — what you see here is what lands.
  const preview = payCountdown(
    {
      frequency,
      dayOne: num(dayOne),
      dayTwo: num(dayTwo),
      anchorDate: anchorDate || null,
    },
    today,
  );
  const net = num(takeHome);
  const perYear = net != null ? net * paychecksPerYear(frequency) : null;

  const submit = () => {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await savePaySchedule({
        frequency,
        dayOne: num(dayOne),
        dayTwo: num(dayTwo),
        anchorDate: anchorDate || null,
        takeHome: num(takeHome),
        depositWindowDays: num(windowDays),
        depositMatch: depositMatch || null,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  const reset = () => {
    start(async () => {
      await clearPaySchedule();
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      {/* Cadence picker — cards rather than a <select> so each option can carry its blurb. */}
      <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
        <h2 className="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
          How often do you get paid?
        </h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {PAY_FREQUENCIES.map((f) => {
            const m = PAY_FREQUENCY_META[f];
            const on = f === frequency;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFrequency(f)}
                className={`text-left rounded-lg border p-3 transition-colors ${
                  on
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40"
                    : "border-neutral-200 dark:border-neutral-800 hover:border-blue-300"
                }`}
              >
                <div className="font-medium text-sm">
                  {m.emoji} {m.label}
                </div>
                <div className="text-xs text-neutral-500 mt-0.5">{m.blurb}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Cadence-specific setup */}
      <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
          When does it land?
        </h2>

        {meta.usesDays ? (
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              <div className="text-xs text-neutral-500 mb-1">
                {frequency === "semimonthly" ? "First payday" : "Payday"}
              </div>
              <input
                type="number"
                min={1}
                max={31}
                value={dayOne}
                onChange={(e) => setDayOne(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                className={`${inputCls} w-24`}
              />
            </label>
            {frequency === "semimonthly" && (
              <label className="text-sm">
                <div className="text-xs text-neutral-500 mb-1">Second payday</div>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={dayTwo}
                  onChange={(e) => setDayTwo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  className={`${inputCls} w-24`}
                />
              </label>
            )}
            <p className="text-xs text-neutral-400 max-w-sm">
              Day of the month. A date past the end of a short month slides to the last day — a
              31st payday lands on the 30th in April. Weekends are not adjusted for.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              <div className="text-xs text-neutral-500 mb-1">A recent payday</div>
              <input
                type="date"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
                className={`${inputCls} w-44`}
              />
            </label>
            <p className="text-xs text-neutral-400 max-w-sm">
              Every {frequency === "weekly" ? "7" : "14"} days is counted off this date, forward and
              back. Any real payday works — recent is easiest to remember.
            </p>
          </div>
        )}

        <div className="pt-1">
          <label className="text-sm">
            <div className="text-xs text-neutral-500 mb-1">Estimated take-home per paycheck</div>
            <input
              inputMode="decimal"
              placeholder="1850.00"
              value={takeHome}
              onChange={(e) => setTakeHome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className={`${inputCls} w-40`}
            />
          </label>
          <p className="text-xs text-neutral-400 mt-1">
            What actually hits the bank, after taxes and deductions.
            {perYear != null && (
              <> Roughly {formatMoney(perYear)}/year across {paychecksPerYear(frequency)} checks.</>
            )}
          </p>
        </div>

        {/* How the projection recognises a payday that already landed. Without this it adds the
            scheduled amount on top of deposits already sitting in the balance. */}
        <div className="pt-4 border-t border-neutral-200 dark:border-neutral-800 space-y-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Matching real deposits</div>
          <label className="text-sm block">
            <div className="text-xs text-neutral-500 mb-1">Deposit window (± days)</div>
            <input
              inputMode="numeric"
              value={windowDays}
              onChange={(e) => setWindowDays(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className={`${inputCls} w-20`}
            />
          </label>
          <p className="text-xs text-neutral-400 max-w-md">
            A split direct deposit pays its halves on different days, and a payday can land early
            before a holiday. Payroll arriving within this many days of a scheduled payday counts as
            that payday, so the projection only adds the part that hasn&apos;t shown up yet — rather
            than the whole amount on top of money already in the account.
          </p>
          <label className="text-sm block">
            <div className="text-xs text-neutral-500 mb-1">Payroll description pattern (optional)</div>
            <input
              placeholder={DEFAULT_DEPOSIT_MATCH}
              value={depositMatch}
              onChange={(e) => setDepositMatch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className={`${inputCls} w-full max-w-md font-mono text-xs`}
            />
          </label>
          <p className="text-xs text-neutral-400 max-w-md">
            Case-insensitive regular expression, alternatives separated by <code>|</code>. Leave it
            blank for the default above. If a paycheck&apos;s description doesn&apos;t match, the
            projection can&apos;t tell it apart from a refund — it shows up as unexpected income on
            the budget screen, which is the cue to add the wording here.
          </p>
        </div>
      </section>

      {/* Live preview of exactly what the dashboard will render */}
      <section className="rounded-lg border border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30 p-5">
        <div className="text-xs uppercase tracking-wide text-neutral-500">Preview</div>
        {preview ? (
          <div className="mt-1">
            <div className="text-3xl font-bold tabular-nums text-indigo-700 dark:text-indigo-300">
              {countdownLabel(preview.daysUntil)}
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              Next payday {formatDate(preview.next)}
              {net != null && <> · {formatMoney(net)} incoming</>}
            </div>
          </div>
        ) : (
          <div className="mt-1 text-sm text-neutral-500">
            Fill in the fields above to see your countdown.
          </div>
        )}
      </section>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save schedule"}
        </button>
        {saved && !pending && (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved ✓</span>
        )}
        {initial && (
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            className="text-sm text-neutral-500 hover:text-red-600 disabled:opacity-50"
          >
            Remove schedule
          </button>
        )}
      </div>
    </div>
  );
}
