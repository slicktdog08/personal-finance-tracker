import { Icon, cx } from "@/components/ds";

/**
 * Where you are in an import: done steps get a check, the current one the accent. Wraps on a
 * phone rather than scrolling sideways.
 */
export function ImportSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs" aria-label="Import steps">
      {steps.map((label, i) => {
        const done = i < current;
        const on = i === current;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={on ? "step" : undefined}>
            <span
              className={cx(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
                on ? "bg-accent text-accent-ink" : done ? "bg-accent-soft text-accent-text" : "bg-sunken text-fg-3",
              )}
            >
              {done ? <Icon name="check" size={12} /> : <span className="tabular-nums">{i + 1}</span>}
              {label}
            </span>
            {i < steps.length - 1 && <Icon name="chevron-right" size={12} className="text-fg-3" />}
          </li>
        );
      })}
    </ol>
  );
}
