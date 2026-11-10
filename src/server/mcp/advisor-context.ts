import "server-only";
import { readFileSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { appSettings } from "@/server/db/schema";

// Standing context for the financial-advisor persona: who the client is, the plan already in
// motion, and the caveats about which data can be trusted. It is personal, so it never lives
// in code. Where it is read from, first match wins:
//
//   1. the `advisor_profile` row of app_settings     (the normal home — survives redeploys and
//                                                     fresh clones with nothing to copy)
//   2. config/advisor-profile.json                  (git-ignored; handy before the DB exists,
//                                                     or overridden by ADVISOR_PROFILE_PATH)
//   3. a neutral profile that tells Claude to ask
//
// Write it with the `update_advisor_profile` MCP tool, or load a JSON file with
// `npx tsx scripts/advisor-profile.ts import <file>` (template: config/advisor-profile.example.json).
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

export const ADVISOR_PROFILE_KEY = "advisor_profile";

const DEFAULT_STYLE = [
  "Act like a fee-only financial planner who already knows the client: concrete numbers, trade-offs, and a recommendation — not generic tips.",
  "Ground every claim in tool data; when data is missing or stale, say what you'd need.",
  "Before any write tool, state exactly what will change and wait for confirmation.",
];

const EMPTY_PROFILE: AdvisorProfile = {
  updatedOn: "never",
  situation: [
    "No advisor profile is saved yet. Ask the user about their income, goals and debts before giving advice, then offer to save it with update_advisor_profile.",
  ],
  plan: [],
  dataCaveats: ["Amounts are USD dollars (numbers, 2dp). Dates are ISO YYYY-MM-DD; periods are YYYY-MM."],
  advisorStyle: DEFAULT_STYLE,
};

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

/** Coerce whatever was stored (DB JSON or a hand-edited file) into a complete profile. */
export function normalizeAdvisorProfile(raw: unknown): AdvisorProfile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const style = strings(r.advisorStyle);
  return {
    name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : undefined,
    updatedOn: typeof r.updatedOn === "string" ? r.updatedOn : "unknown",
    situation: strings(r.situation),
    plan: strings(r.plan),
    dataCaveats: strings(r.dataCaveats),
    advisorStyle: style.length ? style : DEFAULT_STYLE,
  };
}

function profilePath(): string {
  return process.env.ADVISOR_PROFILE_PATH?.trim() || join(process.cwd(), "config", "advisor-profile.json");
}

function readProfileFile(): AdvisorProfile | null {
  try {
    return normalizeAdvisorProfile(JSON.parse(readFileSync(profilePath(), "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[advisor] could not read ${profilePath()}:`, e);
    }
    return null;
  }
}

// The profile is read on every MCP request and get_advisor_context call; a short cache keeps
// that to one tiny query a minute. saveAdvisorProfile() refreshes it immediately.
const TTL_MS = 60_000;
let cached: { profile: AdvisorProfile; at: number } | null = null;

export async function getAdvisorProfile(): Promise<AdvisorProfile> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.profile;
  let profile: AdvisorProfile | null = null;
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.settingKey, ADVISOR_PROFILE_KEY))
      .limit(1);
    if (row) profile = normalizeAdvisorProfile(row.value);
  } catch (e) {
    // Table not migrated yet, or the DB is briefly unreachable — fall through to the file.
    console.error("[advisor] could not read the advisor profile from app_settings:", e);
  }
  profile ??= readProfileFile() ?? EMPTY_PROFILE;
  cached = { profile, at: Date.now() };
  return profile;
}

export async function saveAdvisorProfile(profile: AdvisorProfile): Promise<AdvisorProfile> {
  const value = normalizeAdvisorProfile(profile);
  await db
    .insert(appSettings)
    .values({ settingKey: ADVISOR_PROFILE_KEY, value })
    .onDuplicateKeyUpdate({ set: { value } });
  cached = { profile: value, at: Date.now() };
  return value;
}
