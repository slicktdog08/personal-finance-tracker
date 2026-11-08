/**
 * The MiPlata mark: a coin (rim ring + glint = plata) stamped with "₥" — a lowercase m struck
 * through like a currency sign (mi = my money). The solid variant follows the accent token;
 * the outline variant is one color (currentColor).
 */
export function BrandMark({
  size = 32,
  variant = "solid",
  className = "",
  style,
}: {
  size?: number;
  variant?: "solid" | "outline";
  className?: string;
  style?: React.CSSProperties;
}) {
  const outline = variant === "outline";
  const ink = outline ? "currentColor" : "var(--mp-accent-ink)";
  return (
    <svg className={"mp-mark " + className} width={size} height={size} viewBox="0 0 96 96" aria-hidden="true" style={style}>
      {outline ? (
        <>
          <circle cx="48" cy="48" r="41" fill="none" stroke="currentColor" strokeWidth="6" />
          <circle cx="48" cy="48" r="33" fill="none" stroke="currentColor" strokeWidth="2" strokeOpacity=".5" />
        </>
      ) : (
        <>
          <circle cx="48" cy="48" r="44" fill="var(--mp-accent)" />
          <circle cx="48" cy="48" r="37" fill="none" stroke={ink} strokeOpacity=".38" strokeWidth="2.5" />
        </>
      )}
      <path
        d="M27 68V44a10.5 10.5 0 0 1 21 0v24M48 44a10.5 10.5 0 0 1 21 0v24"
        fill="none"
        stroke={ink}
        strokeWidth={outline ? 9 : 10}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M17 60h62" fill="none" stroke={ink} strokeWidth={outline ? 5.5 : 6} strokeLinecap="round" />
      {!outline && (
        <path
          d="M63 15.5a35 35 0 0 1 16.5 15"
          fill="none"
          stroke="var(--mp-accent-soft-2)"
          strokeOpacity=".9"
          strokeWidth="5"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/** "Mi" Outfit 300 + "Plata" Outfit 700 — the weight shift carries the meaning. */
export function Wordmark({ size = 22, className = "", style }: { size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={"mp-wordmark " + className} style={{ fontSize: size, ...style }} aria-label="MiPlata">
      <span className="mp-wordmark__mi">Mi</span>
      <span className="mp-wordmark__plata">Plata</span>
    </span>
  );
}
