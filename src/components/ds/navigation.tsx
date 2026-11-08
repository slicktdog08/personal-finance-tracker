import Link from "next/link";
import { Icon } from "./Icon";
import { IconButton, cx } from "./core";
import { LinkPending } from "./LinkPending";

/**
 * Screen title row. Below lg the eyebrow and title hide by default — the top bar (and sub-tabs)
 * already name the screen — while the description and actions stay. Pass showTitleOnMobile when
 * the title says something the top bar doesn't (a month, a settings sub-page).
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  hideOnMobile,
  showTitleOnMobile,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  hideOnMobile?: boolean;
  showTitleOnMobile?: boolean;
  className?: string;
}) {
  const hideTitle = !showTitleOnMobile ? "max-lg:hidden" : undefined;
  return (
    <div className={cx("mp-pagehead", hideOnMobile && "mp-pagehead--hide-mobile", className)}>
      <div className={cx("min-w-0 flex-1 basis-80", !description && hideTitle)}>
        {eyebrow && <div className={cx("mp-pagehead__eyebrow", hideTitle)}>{eyebrow}</div>}
        <h1 className={cx("mp-pagehead__title", hideTitle)}>{title}</h1>
        {description && <p className="mp-pagehead__desc">{description}</p>}
      </div>
      {actions && <div className="mp-pagehead__actions">{actions}</div>}
    </div>
  );
}

/** Prev / label / next. Pass hrefs for server-rendered pages, or handlers for client state. */
export function MonthNav({
  label,
  onPrev,
  onNext,
  prevHref,
  nextHref,
  className,
}: {
  label: React.ReactNode;
  onPrev?: () => void;
  onNext?: () => void;
  prevHref?: string;
  nextHref?: string;
  className?: string;
}) {
  const linkCls = "mp-btn mp-iconbtn mp-btn--ghost mp-btn--sm";
  return (
    <div className={cx("mp-monthnav", className)}>
      {prevHref ? (
        <Link href={prevHref} className={linkCls} aria-label="Previous month" title="Previous month">
          <Icon name="chevron-left" size={16} />
        </Link>
      ) : (
        <IconButton icon="chevron-left" label="Previous month" size="sm" onClick={onPrev} disabled={!onPrev} />
      )}
      <span className="mp-monthnav__label">{label}</span>
      {nextHref ? (
        <Link href={nextHref} className={linkCls} aria-label="Next month" title="Next month">
          <Icon name="chevron-right" size={16} />
        </Link>
      ) : (
        <IconButton icon="chevron-right" label="Next month" size="sm" onClick={onNext} disabled={!onNext} />
      )}
    </div>
  );
}

export interface SubTab<V extends string = string> {
  value: V;
  label: React.ReactNode;
  count?: number;
}

/** Underline tabs for in-page state ("For you / Following"). For routes, use LinkTabs. */
export function SubTabs<V extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: SubTab<V>[];
  value: V;
  onChange?: (v: V) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cx("mp-subtabs", className)} role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={t.value === value} onClick={() => onChange?.(t.value)}>
          {t.label}
          {t.count != null && <span className="mp-subtabs__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** SubTabs whose tabs are routes; `current` is the active href. */
export function LinkTabs({
  tabs,
  current,
  label,
  sticky,
  className,
}: {
  tabs: { href: string; label: React.ReactNode; count?: number }[];
  current: string | null;
  label?: string;
  /** Pin under the mobile top bar. */
  sticky?: boolean;
  className?: string;
}) {
  return (
    <nav className={cx("mp-subtabs", sticky && "mp-subtabs--sticky", className)} aria-label={label}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === current ? "page" : undefined}>
          <LinkPending />
          {t.label}
          {t.count != null && <span className="mp-subtabs__count">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
