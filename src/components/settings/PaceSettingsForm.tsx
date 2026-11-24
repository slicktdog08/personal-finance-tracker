"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ds";
import { savePaceSettings } from "@/server/actions/pace";
import type { PaceConfig } from "@/server/lib/spending-pace";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Every Spending Pace setting. Category lists pick from the user's own categories. */
export function PaceSettingsForm({ initial, categories }: { initial: PaceConfig; categories: string[] }) {
  const [cfg, setCfg] = useState<PaceConfig>(initial);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState<string | null>(null);
  const set = <K extends keyof PaceConfig>(k: K, v: PaceConfig[K]) => {
    setCfg((c) => ({ ...c, [k]: v }));
    setSaved(null);
  };
  const num = (k: keyof PaceConfig) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);
  const save = () =>
    start(async () => {
      const next = await savePaceSettings(cfg);
      setCfg(next);
      setSaved("Saved.");
    });

  return (
    <div className="grid gap-6 max-w-3xl">
      <Section title="Allowance">
        <Field label="Savings target (% of income)">
          <input type="number" min={0} max={90} step={1} className="mp-input w-28" value={cfg.savingsPct} onChange={num("savingsPct")} />
        </Field>
        <Field label="Baseline window (days)" hint="Income, fixed costs and essentials are averaged over this many trailing days.">
          <input type="number" min={28} max={365} className="mp-input w-28" value={cfg.baselineDays} onChange={num("baselineDays")} />
        </Field>
        <CategoryPicker label="Essentials categories" hint="Averaged into the essentials baseline; never discretionary." all={categories} value={cfg.essentialsCategories} onChange={(v) => set("essentialsCategories", v)} />
        <CategoryPicker label="Fixed-cost categories" hint="Paid outside a bill (rent by transfer, say): averaged into fixed costs; never discretionary." all={categories} value={cfg.fixedCategories} onChange={(v) => set("fixedCategories", v)} />
        <CategoryPicker label="Excluded categories" hint="Neither spending nor income: transfers, card payments, investing." all={categories} value={cfg.excludedCategories} onChange={(v) => set("excludedCategories", v)} />
        <CategoryPicker label="Income categories" hint="Credits in these count as income." all={categories} value={cfg.incomeCategories} onChange={(v) => set("incomeCategories", v)} />
        <CategoryPicker label="Cost of carrying debt" hint="Interest and fees, shown on their own line." all={categories} value={cfg.carryingCategories} onChange={(v) => set("carryingCategories", v)} />
      </Section>

      <Section title="Windows and status">
        <div className="flex flex-wrap gap-4">
          <Field label="Short window (days)">
            <input type="number" min={3} max={60} className="mp-input w-24" value={cfg.windows.short} onChange={(e) => set("windows", { ...cfg.windows, short: Number(e.target.value) })} />
          </Field>
          <Field label="Main window (days)">
            <input type="number" min={3} max={90} className="mp-input w-24" value={cfg.windows.mid} onChange={(e) => set("windows", { ...cfg.windows, mid: Number(e.target.value) })} />
          </Field>
          <Field label="Long window (days)">
            <input type="number" min={3} max={120} className="mp-input w-24" value={cfg.windows.long} onChange={(e) => set("windows", { ...cfg.windows, long: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-4">
          <Field label="Warning after (days over break-even)">
            <input type="number" min={1} max={60} className="mp-input w-24" value={cfg.warningDays} onChange={num("warningDays")} />
          </Field>
          <Field label="Alert after (days)">
            <input type="number" min={1} max={60} className="mp-input w-24" value={cfg.alertDays} onChange={num("alertDays")} />
          </Field>
          <Field label="Step down after (days below)">
            <input type="number" min={1} max={60} className="mp-input w-24" value={cfg.deescalateDays} onChange={num("deescalateDays")} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-4">
          <Field label="Alert at long average ×">
            <input type="number" min={1} max={5} step={0.05} className="mp-input w-24" value={cfg.alertMultiplier} onChange={num("alertMultiplier")} />
          </Field>
          <Field label="Alert after card growth (weeks)">
            <input type="number" min={1} max={26} className="mp-input w-24" value={cfg.cardGrowthWeeks} onChange={num("cardGrowthWeeks")} />
          </Field>
          <Field label="Stale after no sync (days)">
            <input type="number" min={1} max={30} className="mp-input w-24" value={cfg.staleDays} onChange={num("staleDays")} />
          </Field>
        </div>
      </Section>

      <Section title="Indicators and one-offs">
        <div className="flex flex-wrap gap-4">
          <Field label="Big-night threshold ($)">
            <input type="number" min={1} className="mp-input w-28" value={cfg.bigNightThreshold} onChange={num("bigNightThreshold")} />
          </Field>
          <Field label="Merchant streak (visits in 7 days)">
            <input type="number" min={2} max={50} className="mp-input w-24" value={cfg.merchantStreakCount} onChange={num("merchantStreakCount")} />
          </Field>
          <Field label="Spread one-offs over (days)">
            <input type="number" min={2} max={365} className="mp-input w-24" value={cfg.spreadDays} onChange={num("spreadDays")} />
          </Field>
        </div>
      </Section>

      <Section title="Weekly digest">
        <div className="flex flex-wrap gap-4">
          <Field label="Day">
            <select className="mp-select" value={cfg.digestDay} onChange={(e) => set("digestDay", Number(e.target.value))}>
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Time (server time)">
            <input type="time" className="mp-input" value={cfg.digestTime} onChange={(e) => set("digestTime", e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-fg-3">The digest and any Warning or Alert notice appear in Insights.</p>
      </Section>

      <div className="flex items-center gap-3">
        <Button loading={pending} onClick={save}>
          Save settings
        </Button>
        {saved && <span className="text-sm text-fg-2">{saved}</span>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-fg-2">{label}</span>
      {children}
      {hint && <span className="text-xs text-fg-3">{hint}</span>}
    </label>
  );
}

function CategoryPicker({ label, hint, all, value, onChange }: { label: string; hint?: string; all: string[]; value: string[]; onChange: (v: string[]) => void }) {
  // Keep any configured name that's no longer a category visible, so it can be removed.
  const names = [...new Set([...all, ...value])];
  const on = new Set(value);
  return (
    <fieldset className="grid gap-1.5 text-sm">
      <legend className="text-fg-2 mb-1">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {names.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={on.has(n)}
            onClick={() => onChange(on.has(n) ? value.filter((v) => v !== n) : [...value, n])}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${on.has(n) ? "border-accent bg-accent-soft text-fg" : "border-line text-fg-3"}`}
          >
            {n}
          </button>
        ))}
      </div>
      {hint && <span className="text-xs text-fg-3">{hint}</span>}
    </fieldset>
  );
}
