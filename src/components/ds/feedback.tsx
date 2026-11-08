import Link from "next/link";
import { Icon, type IconName } from "./Icon";
import { Money, cx } from "./core";

export type NoticeTone = "info" | "warn" | "danger" | "ok" | "neutral";
const NOTICE_ICONS: Record<NoticeTone, IconName> = {
  info: "info",
  warn: "triangle-alert",
  danger: "circle-alert",
  ok: "circle-check",
  neutral: "info",
};

/** Calm inline message. Say what's okay before what isn't; danger is for real failures. */
export function Notice({
  tone = "info",
  icon,
  title,
  children,
  action,
  className,
}: {
  tone?: NoticeTone;
  icon?: IconName;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("mp-notice", "mp-notice--" + tone, className)} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={icon ?? NOTICE_ICONS[tone]} size={16} className="mp-notice__icon" />
      <div className="mp-notice__body">
        {title && <div className="mp-notice__title">{title}</div>}
        {children && <div className="mp-notice__text">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export interface AttentionItem {
  id: string;
  label: React.ReactNode;
  tone?: "danger" | "warn" | "info" | "pending";
  amount?: number;
  /** Navigates when set; otherwise onClick. */
  href?: string;
  onClick?: () => void;
}

/** Dashboard "needs action" row: neutral pills with a colored dot, never a red banner. */
export function AttentionStrip({ items, className }: { items: AttentionItem[]; className?: string }) {
  if (!items.length) return null;
  return (
    <div className={cx("mp-attn", className)} role="list">
      {items.map((it) => {
        const cls = "mp-attn__item mp-attn__item--" + (it.tone ?? "info");
        const body = (
          <>
            <span className="mp-attn__dot" />
            {it.label}
            {it.amount != null && <Money value={it.amount} kind="neutral" sign="none" />}
          </>
        );
        return it.href ? (
          <Link key={it.id} href={it.href} role="listitem" className={cls}>
            {body}
          </Link>
        ) : (
          <button key={it.id} type="button" role="listitem" className={cls} onClick={it.onClick}>
            {body}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({
  icon = "sparkles",
  title,
  body,
  action,
  compact,
  className,
}: {
  icon?: IconName;
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("mp-empty", compact && "mp-empty--compact", className)}>
      <div className="mp-empty__icon">
        <Icon name={icon} size={22} />
      </div>
      <div className="mp-empty__title">{title}</div>
      {body && <div className="mp-empty__body">{body}</div>}
      {action && <div className="mp-empty__action">{action}</div>}
    </div>
  );
}

export function Skeleton({
  width = "100%",
  height = 14,
  radius = 6,
  lines,
  gap = 8,
  className,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  lines?: number;
  gap?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (lines)
    return (
      <div className="flex flex-col" style={{ gap }} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className={cx("mp-skel", className)} style={{ width: i === lines - 1 ? "62%" : width, height, borderRadius: radius }} />
        ))}
      </div>
    );
  return <span className={cx("mp-skel", className)} style={{ width, height, borderRadius: radius, ...style }} aria-hidden="true" />;
}
