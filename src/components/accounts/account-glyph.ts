import type { IconName } from "@/components/ds";

// Accounts carry no user color, so the glyph is keyed off the account type: one icon and tint
// per type, the same on every row (credit cards and loans share the owed clay).
const GLYPHS: Record<string, { icon: IconName; color: string }> = {
  Checking: { icon: "landmark", color: "#0ea5e9" },
  Savings: { icon: "piggy-bank", color: "#22c55e" },
  Cash: { icon: "wallet", color: "#84cc16" },
  Retirement: { icon: "trending-up", color: "#8b5cf6" },
  Credit: { icon: "credit-card", color: "#c4562f" },
  Loan: { icon: "landmark", color: "#c4562f" },
  Other: { icon: "building-2", color: "#6366f1" },
};

export function accountGlyph(type: string | null | undefined): { icon: IconName; color: string } {
  return GLYPHS[type ?? ""] ?? { icon: "circle-help", color: "#64748b" };
}

/** "Chase ··1234" — the kit's account sub line, minus the sync part. */
export function accountMaskLine(a: { institution: string | null; accountType: string | null; accountNumber: string }): string {
  const lead = a.institution || a.accountType || "Account";
  // The wallet's "number" is a placeholder key, not a real mask (the dashboard omits it too).
  return a.accountType === "Cash" ? lead : `${lead} ··${a.accountNumber.slice(-4)}`;
}
