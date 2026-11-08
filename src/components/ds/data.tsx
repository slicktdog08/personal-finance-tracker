import { memo } from "react";
import { Icon, type IconName } from "./Icon";
import { Money, cx, type VarStyle } from "./core";

export type BadgeVariant = "tint" | "solid" | "outline" | "pending";

export interface BadgeProps {
  label?: string | null;
  /** Any user-picked hex. Tint/dot are derived in oklch with fixed lightness, so it stays legible. */
  color?: string | null;
  /** tint (categories), solid (bill statuses), outline, pending (dashed). */
  variant?: BadgeVariant;
  dot?: boolean;
  icon?: IconName;
  /** A user-picked emoji shown before the label (categories, goals). */
  emoji?: string | null;
  size?: "sm" | "md" | "lg";
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function Badge({ label, color, variant = "tint", dot = true, icon, emoji, size = "md", onClick, title, className, style }: BadgeProps) {
  if (!label) return <span className="text-fg-3">{"—"}</span>;
  const cls = cx("mp-badge", variant !== "tint" && "mp-badge--" + variant, size !== "md" && "mp-badge--" + size, className);
  const st: VarStyle = { ...(color ? { "--c": color } : null), ...style };
  const inner = (
    <>
      {icon ? (
        <Icon name={icon} size={size === "sm" ? 11 : 12} />
      ) : variant === "pending" ? (
        <Icon name="clock-3" size={11} />
      ) : emoji ? (
        <span aria-hidden>{emoji}</span>
      ) : (
        dot && <span className="mp-badge__dot" />
      )}
      <span className="mp-badge__label">{label}</span>
    </>
  );
  if (onClick)
    return (
      <button type="button" className={cls} style={st} onClick={onClick} title={title ?? label}>
        {inner}
      </button>
    );
  return (
    <span className={cls} style={st} title={title}>
      {inner}
    </span>
  );
}

/** Tinted avatar tile (account / category). Replaces emoji-in-headings; a picked emoji goes inside. */
export function Glyph({
  icon,
  color,
  size = "md",
  children,
  className,
  style,
}: {
  icon?: IconName;
  color?: string | null;
  size?: "sm" | "md" | "lg";
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const px = size === "sm" ? 14 : size === "lg" ? 20 : 16;
  const st: VarStyle = { ...(color ? { "--c": color } : null), ...style };
  return (
    <span className={cx("mp-glyph", size !== "md" && "mp-glyph--" + size, className)} style={st} aria-hidden="true">
      {icon ? <Icon name={icon} size={px} /> : children}
    </span>
  );
}

/** Key / amount line. Pass onClick to make the whole row a button. */
export function ListRow({
  lead,
  title,
  sub,
  end,
  endSub,
  onClick,
  className,
}: {
  lead?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  end?: React.ReactNode;
  endSub?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      {lead}
      <div className="mp-listrow__main">
        <div className="mp-listrow__title">{title}</div>
        {sub && <div className="mp-listrow__sub">{sub}</div>}
      </div>
      {(end || endSub) && (
        <div className="mp-listrow__end">
          {end}
          {endSub && <div className="mp-listrow__sub">{endSub}</div>}
        </div>
      )}
    </>
  );
  if (onClick)
    return (
      <button type="button" className={cx("mp-listrow", "mp-listrow--button", className)} onClick={onClick}>
        {body}
      </button>
    );
  return <div className={cx("mp-listrow", className)}>{body}</div>;
}

export interface ProgressBarProps {
  value?: number;
  max?: number;
  /** Stacked fills (e.g. paid + pending); overrides value/color. */
  segments?: { value: number; color?: string }[];
  color?: string;
  size?: "sm" | "md" | "lg";
  /** A tick at this value (e.g. "where you should be today"). */
  marker?: number;
  label?: string;
  legendLeft?: React.ReactNode;
  legendRight?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function ProgressBar({ value = 0, max = 100, segments, color, size = "md", marker, label, legendLeft, legendRight, className, style }: ProgressBarProps) {
  const pct = (v: number) => Math.max(0, Math.min(100, (v / (max || 1)) * 100));
  const segs = segments ?? [{ value, color }];
  return (
    <div className={cx("mp-progress", size !== "md" && "mp-progress--" + size, className)} style={style}>
      <div className="mp-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        {segs.map((s, i) => (
          <div key={i} className="mp-progress__fill" style={{ width: pct(s.value) + "%", "--bar": s.color || undefined } as VarStyle} />
        ))}
        {marker != null && <div className="mp-progress__marker" style={{ left: "calc(" + pct(marker) + "% - 1px)" }} />}
      </div>
      {(legendLeft || legendRight) && (
        <div className="mp-progress__legend">
          <span>{legendLeft}</span>
          <span>{legendRight}</span>
        </div>
      )}
    </div>
  );
}

export interface StatTileProps {
  label: React.ReactNode;
  /** A number renders through Money; anything else renders as-is. */
  value: React.ReactNode;
  kind?: "neutral" | "income" | "owed" | "over" | "plan" | "pending" | "muted";
  /** hero = the one 48px number per screen; md 28px KPI; sm 18px. */
  size?: "sm" | "md" | "hero";
  sub?: React.ReactNode;
  delta?: { dir?: "up" | "down" | "flat"; label: React.ReactNode };
  icon?: IconName;
  cents?: "inline" | "dim";
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function StatTile({ label, value, kind = "neutral", size = "md", sub, delta, icon, cents, children, className, style }: StatTileProps) {
  return (
    <div className={cx("mp-stat", size !== "md" && "mp-stat--" + size, className)} style={style}>
      <div className="mp-stat__label">
        {icon && <Icon name={icon} size={14} />}
        {label}
      </div>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <div className="mp-stat__value">
          {typeof value === "number" ? <Money value={value} kind={kind} sign="none" cents={cents ?? (size === "hero" ? "dim" : "inline")} /> : value}
        </div>
        {delta && (
          <span className={"mp-stat__delta mp-stat__delta--" + (delta.dir ?? "flat")}>
            {delta.dir === "up" && <Icon name="arrow-up-right" size={12} />}
            {delta.dir === "down" && <Icon name="arrow-down-right" size={12} />}
            {delta.label}
          </span>
        )}
      </div>
      {sub && <div className="mp-stat__sub">{sub}</div>}
      {children}
    </div>
  );
}

/** Per-row view state handed to cell renderers, so they don't have to close over it. */
export interface DataTableRowState {
  selected: boolean;
}

export interface DataTableColumn<R> {
  key: string;
  header: React.ReactNode;
  render?: (row: R, state: DataTableRowState) => React.ReactNode;
  /** Tabular, right-aligned, no-wrap. */
  num?: boolean;
  align?: "left" | "right";
  shrink?: boolean;
  width?: number | string;
}

export interface DataTableMobile<R> {
  lead?: (row: R, state: DataTableRowState) => React.ReactNode;
  title?: (row: R, state: DataTableRowState) => React.ReactNode;
  sub?: (row: R, state: DataTableRowState) => React.ReactNode;
  amount?: (row: R, state: DataTableRowState) => React.ReactNode;
  meta?: (row: R, state: DataTableRowState) => React.ReactNode;
}

export interface DataTableProps<R> {
  columns: DataTableColumn<R>[];
  rows: R[];
  rowKey?: (row: R, i: number) => React.Key;
  onRowClick?: (row: R) => void;
  isSelected?: (row: R) => boolean;
  isPending?: (row: R) => boolean;
  /** Consecutive rows with the same value share a group header row (e.g. a date). */
  groupBy?: (row: R) => React.ReactNode;
  /** The 2-line card layout used when the table is under 640px wide (container query). */
  mobile?: DataTableMobile<R>;
  dense?: boolean;
  empty?: React.ReactNode;
  className?: string;
}

const NO_MOBILE = {};
const cell = <R,>(c: DataTableColumn<R>, r: R, state: DataTableRowState) =>
  c.render ? c.render(r, state) : ((r as Record<string, React.ReactNode>)[c.key] ?? null);
const tdClass = <R,>(c: DataTableColumn<R>) => (c.num ? "is-num" : c.align === "right" ? "is-right" : c.shrink ? "is-shrink" : undefined);

interface RowProps<R> {
  row: R;
  columns: DataTableColumn<R>[];
  onRowClick?: (row: R) => void;
  /** undefined when the table has no selection at all. */
  selected?: boolean;
  pending?: boolean;
}

// Rows are memoised: a row re-renders when its own data, selection or pending flag changes, or
// when a cell renderer / handler changes identity. So a caller that keeps its `render`
// functions, `mobile` and `onRowClick` stable (useMemo / useCallback) and its row objects stable
// (useStable) re-renders one row per edit instead of the whole table. Callers that build those
// inline get exactly the old behaviour.

/** What a body row reads from the columns — not `header` or `width`, so a header can change freely. */
const sameCells = <R,>(a: DataTableColumn<R>[], b: DataTableColumn<R>[]) =>
  a === b ||
  (a.length === b.length && a.every((c, i) => c.key === b[i].key && c.render === b[i].render && c.num === b[i].num && c.align === b[i].align && c.shrink === b[i].shrink));

function sameRow<R>(a: RowProps<R> & { mobile?: DataTableMobile<R> }, b: RowProps<R> & { mobile?: DataTableMobile<R> }) {
  return a.row === b.row && a.selected === b.selected && a.pending === b.pending && a.onRowClick === b.onRowClick && a.mobile === b.mobile && sameCells(a.columns, b.columns);
}

function TableRowImpl<R>({ row, columns, onRowClick, selected, pending }: RowProps<R>) {
  const state = { selected: !!selected };
  return (
    <tr data-clickable={!!onRowClick} aria-selected={selected} data-pending={pending} onClick={onRowClick ? () => onRowClick(row) : undefined}>
      {columns.map((c) => (
        <td key={c.key} className={tdClass(c)}>
          {cell(c, row, state)}
        </td>
      ))}
    </tr>
  );
}
const TableRow = memo(TableRowImpl, sameRow) as typeof TableRowImpl;

function CardRowImpl<R>({ row, columns, mobile: m, onRowClick, selected }: RowProps<R> & { mobile: DataTableMobile<R> }) {
  const state = { selected: !!selected };
  return (
    <div className="mp-cardrow" data-clickable={!!onRowClick} onClick={onRowClick ? () => onRowClick(row) : undefined}>
      {m.lead && <div className="mp-cardrow__lead">{m.lead(row, state)}</div>}
      <div className="mp-cardrow__title" style={m.lead ? undefined : { gridColumn: "1 / 3" }}>
        {m.title ? m.title(row, state) : columns[0] && cell(columns[0], row, state)}
      </div>
      <div className="mp-cardrow__amount">{m.amount?.(row, state)}</div>
      <div className="mp-cardrow__sub" style={m.lead ? undefined : { gridColumn: "1 / 3" }}>
        {m.sub?.(row, state)}
      </div>
      <div className="mp-cardrow__meta">{m.meta?.(row, state)}</div>
    </div>
  );
}
const CardRow = memo(CardRowImpl, sameRow) as typeof CardRowImpl;

/** Client-only when you pass function props (they can't cross the server boundary). */
export function DataTable<R>({ columns, rows, rowKey, onRowClick, isSelected, isPending, groupBy, mobile, dense, empty, className }: DataTableProps<R>) {
  const keyOf = rowKey ?? ((r: R, i: number) => ((r as { id?: React.Key }).id ?? i));
  // One flat list of group headers and rows, each keyed by its row (a header by the first row
  // under it). Keying groups by position meant a row changing group — a bill marked paid moving
  // to "Settled" — could shift every group after it and remount every row in the table; flat, it
  // is just one row moving.
  const items: ({ header: React.ReactNode; key: string } | { row: R; key: React.Key })[] = [];
  let last: React.ReactNode | undefined;
  rows.forEach((r, i) => {
    const g = groupBy ? groupBy(r) : null;
    if (g != null && (i === 0 || g !== last)) items.push({ header: g, key: `group:${String(keyOf(r, i))}` });
    last = g;
    items.push({ row: r, key: keyOf(r, i) });
  });
  const m: DataTableMobile<R> = mobile ?? NO_MOBILE;
  return (
    <div className={cx("mp-table-wrap", className)}>
      <table className={cx("mp-table", dense && "mp-table--dense")}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === "right" || c.num ? "is-right" : c.shrink ? "is-shrink" : undefined} style={{ width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((it) =>
            "header" in it ? (
              <tr key={it.key}>
                <td colSpan={columns.length} className="mp-table__groupcell">
                  {it.header}
                </td>
              </tr>
            ) : (
              <TableRow
                key={it.key}
                row={it.row}
                columns={columns}
                onRowClick={onRowClick}
                selected={isSelected ? isSelected(it.row) : undefined}
                pending={isPending ? isPending(it.row) : undefined}
              />
            ),
          )}
        </tbody>
      </table>
      <div className="mp-cardlist">
        {items.map((it) =>
          "header" in it ? (
            <div key={it.key} className="mp-cardrow__groupcell">
              {it.header}
            </div>
          ) : (
            <CardRow key={it.key} row={it.row} columns={columns} mobile={m} onRowClick={onRowClick} selected={isSelected ? isSelected(it.row) : undefined} />
          ),
        )}
      </div>
      {!rows.length && empty}
    </div>
  );
}
