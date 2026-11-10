// Demo mode (DEMO_MODE=1): a public instance full of generated data. The app must never reach
// a real bank aggregator or fire the AI routine from it — the guards that enforce that import
// from here. No server-only imports: scripts and the proxy can use it too.

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1";
}

export const DEMO_LINK_DISABLED = "Bank linking is disabled in the demo — Demo Bank is already connected.";
export const DEMO_ADVISOR_DISABLED =
  "The AI advisor is switched off in the demo. On your own install it runs as a Claude Code routine on your Claude plan.";
