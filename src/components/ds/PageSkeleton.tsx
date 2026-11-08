import { cx } from "./core";
import { Skeleton } from "./feedback";
import { LoadingBeacon } from "./LoadingBeacon";

export interface PageSkeletonProps {
  /** Stat tiles across the top (two per row on phones, four on desktop). */
  tiles?: number;
  /** Card blocks in a two-column grid. */
  cards?: number;
  /** Row items inside one card — the shape of a table or list. */
  rows?: number;
  /** A filter / control strip under the header. */
  controls?: boolean;
  className?: string;
}

// Each block carries its index as --i: motion.css staggers its rise-in and offsets its shimmer
// so the whole screen reads as one wave rather than identical blocks blinking in step.
const stagger = (i: number) => ({ "--i": i }) as React.CSSProperties;

/**
 * The shape a screen takes while its data streams in. Every route's loading.tsx renders one, so
 * a tap swaps the screen at once and the real content lands in place. Mirrors PageHeader: the
 * title row hides below lg because the top bar already names the screen.
 */
export function PageSkeleton({ tiles = 0, cards = 0, rows = 0, controls = false, className }: PageSkeletonProps) {
  let n = 0;
  return (
    <div className={cx("mp-pageskel flex flex-col gap-5", className)} aria-busy="true" aria-label="Loading">
      <LoadingBeacon />
      <div className="mp-pageskel__block flex items-end justify-between gap-4 max-lg:hidden" style={stagger(n++)}>
        <div className="flex flex-col gap-2.5">
          <Skeleton width={96} height={12} />
          <Skeleton width={220} height={28} radius={8} />
        </div>
        <Skeleton width={120} height={36} radius={999} />
      </div>
      {controls && (
        <div className="mp-pageskel__block flex gap-2 overflow-hidden" style={stagger(n++)}>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} width={i === 0 ? 180 : 96} height={34} radius={999} className="shrink-0" />
          ))}
        </div>
      )}
      {tiles > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: tiles }, (_, i) => (
            <div key={i} className="mp-pageskel__block mp-card mp-card--pad flex flex-col gap-3" style={stagger(n++)}>
              <Skeleton width="55%" height={12} />
              <Skeleton width="75%" height={26} radius={8} />
            </div>
          ))}
        </div>
      )}
      {cards > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: cards }, (_, i) => (
            <div key={i} className="mp-pageskel__block mp-card mp-card--pad flex flex-col gap-4" style={stagger(n++)}>
              <div className="flex items-center justify-between">
                <Skeleton width="40%" height={16} />
                <Skeleton width={56} height={12} />
              </div>
              <Skeleton lines={3} height={12} />
              <Skeleton width="100%" height={8} radius={999} />
            </div>
          ))}
        </div>
      )}
      {rows > 0 && (
        <div className="mp-pageskel__block mp-card flex flex-col divide-y divide-line" style={stagger(n++)}>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="mp-pageskel__row flex items-center gap-3 px-4 py-3" style={stagger(i)}>
              <Skeleton width={32} height={32} radius={999} className="shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton width={i % 3 === 1 ? "45%" : "60%"} height={13} />
                <Skeleton width="30%" height={11} />
              </div>
              <Skeleton width={72} height={14} className="shrink-0" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
