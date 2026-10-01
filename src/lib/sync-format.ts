// Small display helpers shared by the sync settings page, badges and the CLI.

export function relativeTime(d: Date | string | null | undefined, now = Date.now()): string {
  if (!d) return "never";
  const t = typeof d === "string" ? Date.parse(d) : d.getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Math.round((now - t) / 1000);
  const abs = Math.abs(diff);
  const fmt = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  let s: string;
  if (abs < 60) s = "moments";
  else if (abs < 3600) s = fmt(Math.round(abs / 60), "minute");
  else if (abs < 86_400) s = fmt(Math.round(abs / 3600), "hour");
  else s = fmt(Math.round(abs / 86_400), "day");
  return diff >= 0 ? `${s} ago` : `in ${s}`;
}

export function intervalLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} min`;
}
