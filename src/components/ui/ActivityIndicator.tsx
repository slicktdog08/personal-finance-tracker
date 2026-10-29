const SPOKES = 8;

export interface ActivityIndicatorProps {
  /** Diameter in px. */
  size?: number;
  className?: string;
}

// iOS-style spinner: eight spokes whose opacity fades in sequence. Each spoke runs the
// same keyframe with a staggered negative delay so the wave is already moving on the
// first frame. Colour comes from `currentColor`. Reduced-motion users get the static
// gradient the base opacities draw.
export function ActivityIndicator({ size = 28, className = "" }: ActivityIndicatorProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`relative inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {Array.from({ length: SPOKES }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          // Spoke is 30% of the box tall, pinned to the top; the box centre is 50% down,
          // i.e. 166.67% of the spoke's own height — the rotation origin.
          className="absolute left-1/2 top-0 h-[30%] w-[9%] rounded-full bg-current origin-[50%_166.67%] motion-safe:animate-[activity-fade_.8s_linear_infinite]"
          style={{
            transform: `translateX(-50%) rotate(${(i * 360) / SPOKES}deg)`,
            opacity: 0.2 + (0.8 * i) / (SPOKES - 1),
            animationDelay: `${((i - SPOKES) * 0.8) / SPOKES}s`,
          }}
        />
      ))}
    </span>
  );
}
