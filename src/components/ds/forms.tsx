import { Icon, type IconName } from "./Icon";
import { cx, type VarStyle } from "./core";

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
  style,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  /** Replaces the hint when set. */
  error?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={cx("mp-field", className)} style={style}>
      {label && (
        <label className="mp-field__label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error ? <div className="mp-field__error">{error}</div> : hint && <div className="mp-field__hint">{hint}</div>}
    </div>
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: IconName;
  /** Right-aligned tabular figures + decimal keypad. */
  money?: boolean;
  invalid?: boolean;
  /** Pill on a sunken fill — for search fields. */
  round?: boolean;
}

export function Input({ icon, money, invalid, round, className, inputMode, ...rest }: InputProps) {
  const el = (
    <input
      className={cx("mp-input", money && "mp-input--money", round && "mp-input--round", className)}
      inputMode={money ? "decimal" : inputMode}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
  if (!icon) return el;
  return (
    <div className="mp-inputwrap">
      <Icon name={icon} size={16} />
      {el}
    </div>
  );
}

export type SelectOption = string | { value: string; label: string };

/** Native select for plain choices. Never for a colored thing — use ColorPicker. */
export function Select({ options = [], className, ...rest }: { options?: SelectOption[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx("mp-select", className)} {...rest}>
      {options.map((o) =>
        typeof o === "string" ? (
          <option key={o} value={o}>
            {o}
          </option>
        ) : (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ),
      )}
    </select>
  );
}

type ToggleProps = { label?: React.ReactNode } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

export function Checkbox({ label, className, ...rest }: ToggleProps) {
  return (
    <label className={cx("mp-check", className)}>
      <input type="checkbox" {...rest} />
      {label}
    </label>
  );
}

export function Switch({ label, className, ...rest }: ToggleProps) {
  return (
    <label className={cx("mp-switch", className)}>
      <input type="checkbox" role="switch" {...rest} />
      {label}
    </label>
  );
}

export type SegmentedOption<V extends string> = V | { value: V; label: React.ReactNode };

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  block,
  label,
  className,
}: {
  options: SegmentedOption<V>[];
  value: V;
  onChange?: (v: V) => void;
  block?: boolean;
  /** Accessible group name. */
  label?: string;
  className?: string;
}) {
  return (
    <div className={cx("mp-seg", block && "mp-seg--block", className)} role="group" aria-label={label}>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? o : o.label;
        return (
          <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange?.(v)}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  color,
  onChange,
  className,
  ...rest
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Track/thumb color; defaults to the accent. */
  color?: string;
  onChange?: (v: number) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "min" | "max" | "step" | "color">) {
  const pct = ((value - min) / (max - min || 1)) * 100;
  const style: VarStyle = { "--pct": pct + "%", ...(color ? { "--rc": color } : null) };
  return (
    <input
      type="range"
      className={cx("mp-range", className)}
      min={min}
      max={max}
      step={step}
      value={value}
      style={style}
      onChange={(e) => onChange?.(Number(e.target.value))}
      {...rest}
    />
  );
}

export interface FilterChip {
  id: string;
  label: React.ReactNode;
  count?: number;
}

/** Search + toggle chips; chips scroll sideways under 560px. */
export function FilterBar({
  search,
  onSearch,
  placeholder = "Search",
  chips = [],
  active = [],
  onToggle,
  children,
  className,
}: {
  search?: string;
  onSearch?: (q: string) => void;
  placeholder?: string;
  chips?: FilterChip[];
  active?: string[];
  onToggle?: (id: string) => void;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("mp-filterbar", className)}>
      <div className="mp-filterbar__row">
        {onSearch && (
          <div className="mp-filterbar__search">
            <Input icon="search" value={search} placeholder={placeholder} onChange={(e) => onSearch(e.target.value)} />
          </div>
        )}
        {children}
      </div>
      {chips.length > 0 && (
        <div className="mp-filterbar__row mp-filterbar__row--scroll mt-2.5">
          {chips.map((c) => (
            <button key={c.id} type="button" className="mp-chip" aria-pressed={active.includes(c.id)} onClick={() => onToggle?.(c.id)}>
              {c.label}
              {c.count != null && <span className="mp-chip__count">{c.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
