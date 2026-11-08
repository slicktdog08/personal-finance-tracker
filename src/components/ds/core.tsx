import { Icon, type IconName } from "./Icon";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Inline style that may carry CSS custom properties (--c, --bar, --pct, --rc, --cols). */
export type VarStyle = React.CSSProperties & Record<`--${string}`, string | number | undefined>;

export type ButtonVariant = "primary" | "secondary" | "ghost" | "soft" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  block?: boolean;
  /** Shows a spinner in place of `icon` and disables the button. */
  loading?: boolean;
}

/** Class string for a pill button — for <Link>/<a> that should look like a Button. */
export function buttonClass({
  variant = "primary",
  size = "md",
  block,
  className,
}: { variant?: ButtonVariant; size?: Size; block?: boolean; className?: string } = {}) {
  return cx("mp-btn", "mp-btn--" + variant, size !== "md" && "mp-btn--" + size, block && "mp-btn--block", className);
}

/** Pill button, 600 weight, verb + object labels ("Mark paid", "Import 3"). */
export function Button({
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  block,
  loading,
  children,
  className,
  type = "button",
  disabled,
  ...rest
}: ButtonProps) {
  const is = size === "sm" ? 15 : size === "lg" ? 18 : 16;
  return (
    <button type={type} className={buttonClass({ variant, size, block, className })} disabled={disabled || loading} {...rest}>
      {loading ? <Icon name="loader-circle" size={is} className="mp-spinner" /> : icon && <Icon name={icon} size={is} />}
      {children}
      {iconRight && <Icon name={iconRight} size={is} />}
    </button>
  );
}

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  /** Required: becomes aria-label and title. */
  label: string;
  variant?: ButtonVariant;
  size?: Size;
}

export function IconButton({ icon, label, variant = "ghost", size = "md", className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx("mp-btn", "mp-iconbtn", "mp-btn--" + variant, size !== "md" && "mp-btn--" + size, className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={size === "sm" ? 16 : size === "lg" ? 20 : 18} />
    </button>
  );
}

export interface CardProps {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  /** Pad the body (default). With a title, padding lives on the body. */
  padded?: boolean;
  variant?: "default" | "sunken";
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
  children?: React.ReactNode;
}

/** White surface, 1px border, 16px radius, hairline shadow. Never tinted by status. */
export function Card({ title, meta, action, icon, padded = true, variant = "default", onClick, className, style, bodyStyle, children }: CardProps) {
  const cls = cx("mp-card", !title && padded && "mp-card--pad", variant === "sunken" && "mp-card--sunken", onClick && "mp-card--interactive", className);
  return (
    <section className={cls} style={style} onClick={onClick}>
      {title && (
        <header className="mp-card__head">
          <div className="mp-card__title">
            {icon}
            {title}
            {meta && <span className="mp-card__meta">{meta}</span>}
          </div>
          {action}
        </header>
      )}
      {title ? (
        <div className="mp-card__body" style={padded ? bodyStyle : { padding: 0, ...bodyStyle }}>
          {children}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

export type MoneyKind = "auto" | "income" | "spend" | "owed" | "pending" | "over" | "plan" | "muted" | "neutral";

const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface MoneyProps {
  value: number | string | null | undefined;
  /** auto: positive → income (+, emerald), negative → spend (true minus, ink). */
  kind?: MoneyKind;
  sign?: "auto" | "always" | "none";
  /** dim: cents at 62% size, raised — for hero figures. */
  cents?: "inline" | "dim";
  /** Whole dollars (prose, legends). Tables always show cents. */
  whole?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

/** One place for the money rules: sign, color, tabular figures. Spend is ink, never red. */
export function Money({ value, kind = "auto", sign = "auto", cents = "inline", whole = false, className, style, title }: MoneyProps) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const k = kind === "auto" ? (n > 0 ? "income" : "spend") : kind;
  let s = "";
  if (sign === "auto") s = n < 0 ? "−" : kind === "auto" && n > 0 ? "+" : "";
  else if (sign === "always") s = n < 0 ? "−" : "+";
  const str = whole ? Math.round(abs).toLocaleString("en-US") : fmt.format(abs);
  const [w, c] = str.split(".");
  return (
    <span className={cx("mp-money", k !== "neutral" && "mp-money--" + k, className)} style={style} title={title}>
      {s}${w}
      {c !== undefined && (cents === "dim" ? <span className="mp-money__cents">.{c}</span> : "." + c)}
    </span>
  );
}
