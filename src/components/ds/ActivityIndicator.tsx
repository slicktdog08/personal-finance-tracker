const SPOKES = 8;

/**
 * iOS-style spinner: eight spokes whose opacity fades in sequence, drawn in currentColor. Each
 * spoke runs the same keyframe with a staggered negative delay so the wave is already moving on
 * the first frame. Reduced-motion users get the static gradient the base opacities draw.
 */
export function ActivityIndicator({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <span role="status" aria-label="Loading" className={"mp-activity " + className} style={{ width: size, height: size }}>
      {Array.from({ length: SPOKES }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="mp-activity__spoke"
          style={{
            transform: `translateX(-50%) rotate(${(i * 360) / SPOKES}deg)`,
            opacity: 0.15 + (0.85 * i) / (SPOKES - 1),
            animationDelay: `${((i - SPOKES) * 0.8) / SPOKES}s`,
          }}
        />
      ))}
    </span>
  );
}
