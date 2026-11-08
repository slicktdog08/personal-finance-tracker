"use client";

import { useState, useTransition } from "react";
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
import { Button, Card, Field, Icon, Input, Notice, Segmented, Select } from "@/components/ds";

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
    });
  };

  const reset = () => {
    start(async () => {
      await clearPaySchedule();
    });
  };

  const enterSubmits = (e: React.KeyboardEvent) => e.key === "Enter" && submit();

  return (
    <div className="space-y-5">
      <Card title="When you get paid" meta="drives the payday countdown">
        <div className="grid max-w-xl gap-4">
          {/* Cadence: segmented from sm up; a select on phones, where four labels don't fit a row. */}
          <Field label="How often do you get paid?" hint={meta.blurb}>
            <Segmented
              label="Pay frequency"
              className="max-sm:hidden"
              value={frequency}
              onChange={setFrequency}
              options={PAY_FREQUENCIES.map((f) => ({ value: f, label: PAY_FREQUENCY_META[f].label }))}
            />
            <Select
              aria-label="Pay frequency"
              className="sm:hidden"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as PayFrequency)}
              options={PAY_FREQUENCIES.map((f) => ({ value: f, label: PAY_FREQUENCY_META[f].label }))}
            />
          </Field>

          {meta.usesDays ? (
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-3">
                <Field label={frequency === "semimonthly" ? "First payday" : "Payday"} htmlFor="pay-day-one">
                  <Input id="pay-day-one" type="number" min={1} max={31} value={dayOne} onChange={(e) => setDayOne(e.target.value)} onKeyDown={enterSubmits} />
                </Field>
                {frequency === "semimonthly" && (
                  <Field label="Second payday" htmlFor="pay-day-two">
                    <Input id="pay-day-two" type="number" min={1} max={31} value={dayTwo} onChange={(e) => setDayTwo(e.target.value)} onKeyDown={enterSubmits} />
                  </Field>
                )}
              </div>
              <p className="text-xs text-fg-3">
                Day of the month. A date past the end of a short month slides to the last day, so a 31st payday lands on the
                30th in April. Weekends are not adjusted for.
              </p>
            </div>
          ) : (
            <Field
              label="A recent payday"
              htmlFor="pay-anchor"
              hint={`Every ${frequency === "weekly" ? "7" : "14"} days is counted off this date, forward and back. Any real payday works; recent is easiest to remember.`}
            >
              <Input id="pay-anchor" type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} className="max-w-52" />
            </Field>
          )}

          <Field
            label="Typical paycheck"
            htmlFor="pay-take-home"
            hint={
              <>
                What actually hits the bank, after taxes and deductions.
                {perYear != null && (
                  <> Roughly {formatMoney(perYear)}/year across {paychecksPerYear(frequency)} checks.</>
                )}
              </>
            }
          >
            <Input id="pay-take-home" money placeholder="1,850.00" value={takeHome} onChange={(e) => setTakeHome(e.target.value)} onKeyDown={enterSubmits} className="max-w-52" />
          </Field>
        </div>
      </Card>

      {/* How the projection recognises a payday that already landed. Without this it adds the
          scheduled amount on top of deposits already sitting in the balance. */}
      <Card title="Matching real deposits">
        <div className="grid max-w-xl gap-4">
          <Field
            label="Deposit window (± days)"
            htmlFor="pay-window"
            hint="A split direct deposit pays its halves on different days, and a payday can land early before a holiday. Payroll arriving within this many days of a scheduled payday counts as that payday, so the projection only adds the part that hasn't shown up yet."
          >
            <Input id="pay-window" inputMode="numeric" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} onKeyDown={enterSubmits} className="max-w-28" />
          </Field>
          <Field
            label="Payroll description pattern (optional)"
            htmlFor="pay-match"
            hint={
              <>
                Case-insensitive regular expression, alternatives separated by <code>|</code>. Leave it blank for the default
                shown. If a paycheck&apos;s description doesn&apos;t match, the projection can&apos;t tell it apart from a refund:
                it shows up as unexpected income on the budget screen, which is the cue to add the wording here.
              </>
            }
          >
            <Input
              id="pay-match"
              placeholder={DEFAULT_DEPOSIT_MATCH}
              value={depositMatch}
              onChange={(e) => setDepositMatch(e.target.value)}
              onKeyDown={enterSubmits}
              className="font-mono text-xs"
            />
          </Field>
        </div>
      </Card>

      {/* Live preview of exactly what the dashboard will render */}
      <Card title="Preview" meta="what the dashboard shows">
        {preview ? (
          <div>
            <div className="font-display text-3xl font-semibold tabular-nums text-plan">{countdownLabel(preview.daysUntil)}</div>
            <div className="mt-1 text-xs text-fg-3">
              Next payday {formatDate(preview.next)}
              {net != null && <> · {formatMoney(net)} incoming</>}
            </div>
          </div>
        ) : (
          <div className="text-sm text-fg-3">Fill in the fields above to see your countdown.</div>
        )}
      </Card>

      {error && <Notice tone="danger">{error}</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} loading={pending} icon="check">
          {pending ? "Saving…" : "Save schedule"}
        </Button>
        {saved && !pending && (
          <span className="inline-flex items-center gap-1 text-sm text-income">
            <Icon name="circle-check" size={16} /> Saved
          </span>
        )}
        {initial && (
          <Button variant="ghost" icon="trash-2" onClick={reset} disabled={pending}>
            Remove schedule
          </Button>
        )}
      </div>
    </div>
  );
}
