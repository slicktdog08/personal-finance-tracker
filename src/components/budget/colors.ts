// The plan's palette, in MiPlata money tokens so every bar and dot means the same thing as the
// rest of the app: debt is clay (owed), the extra is a lighter clay, everyday envelopes take the
// accent, savings is sky (plan), over is rose. Tokens (not hex) so dark mode and the Marigold
// accent follow automatically. A category's own user-picked color still wins on its envelope.
export const PLAN_COLORS = {
  debt: "var(--mp-money-owed)",
  extra: "color-mix(in oklch, var(--mp-money-owed) 50%, var(--mp-bg-surface))",
  spend: "var(--mp-accent)",
  savings: "var(--mp-money-plan)",
  over: "var(--mp-money-over)",
  free: "var(--mp-plata-300)",
} as const;
