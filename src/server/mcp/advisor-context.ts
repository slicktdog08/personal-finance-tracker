import "server-only";
import { readFileSync } from "fs";
import { join } from "path";

// Standing context for the financial-advisor persona: who the client is, the plan already in
// motion, and the caveats about which data can be trusted. It is personal, so it lives in a
// git-ignored file rather than in code:
//
//   config/advisor-profile.json            your profile (ignored by git)
//   config/advisor-profile.example.json    the committed template
//
// ADVISOR_PROFILE_PATH overrides the location. Run the `/setup` Claude Code skill (or copy the
// example) to create it; bump `updatedOn` when the plan changes so Claude knows how stale it is.
// Keep it short and factual — it is prepended to every advisor conversation.

export interface AdvisorProfile {
  /** How the advisor should refer to you ("Alex"). Optional. */
  name?: string;
  updatedOn: string;
  situation: string[];
  plan: string[];
  dataCaveats: string[];
  advisorStyle: string[];
}

const DEFAULT_STYLE = [
  "Act like a fee-only financial planner who already knows the client: concrete numbers, trade-offs, and a recommendation — not generic tips.",
  "Ground every claim in tool data; when data is missing or stale, say what you'd need.",
  "Before any write tool, state exactly what will change and wait for confirmation.",
];

const EMPTY_PROFILE: AdvisorProfile = {
  updatedOn: "never",
  situation: [
    "No advisor profile is configured (config/advisor-profile.json is missing). Ask the user about their income, goals and debts before giving advice, and suggest they run the /setup skill to save it.",
  ],
  plan: [],
  dataCaveats: ["Amounts are USD dollars (numbers, 2dp). Dates are ISO YYYY-MM-DD; periods are YYYY-MM."],
  advisorStyle: DEFAULT_STYLE,
};

function profilePath(): string {
  return process.env.ADVISOR_PROFILE_PATH?.trim() || join(process.cwd(), "config", "advisor-profile.json");
}

let cached: AdvisorProfile | null = null;

/** Read once per process; a missing or malformed file falls back to a neutral profile. */
export function getAdvisorProfile(): AdvisorProfile {
  if (cached) return cached;
  try {
    const raw = JSON.parse(readFileSync(profilePath(), "utf8")) as Partial<AdvisorProfile>;
    cached = {
      name: raw.name?.trim() || undefined,
      updatedOn: raw.updatedOn ?? "unknown",
      situation: raw.situation ?? [],
      plan: raw.plan ?? [],
      dataCaveats: raw.dataCaveats ?? [],
      advisorStyle: raw.advisorStyle?.length ? raw.advisorStyle : DEFAULT_STYLE,
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[advisor] could not read ${profilePath()}:`, e);
    }
    cached = EMPTY_PROFILE;
  }
  return cached;
}
