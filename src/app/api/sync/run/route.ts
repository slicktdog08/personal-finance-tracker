import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runSync } from "@/server/lib/sync/sync";

// Fallback trigger for a host cron (`curl -H "Authorization: Bearer $SYNC_CRON_SECRET"`)
// when the in-process scheduler isn't wanted. Also reachable with a normal session (the
// proxy lets a signed-in cookie through), which is what "Sync now" could use if the
// Server Action ever hits a body/time limit.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function bearerOk(request: NextRequest): boolean {
  const secret = process.env.SYNC_CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length === secret.length && timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}

export async function POST(request: NextRequest) {
  // The proxy already required either a session cookie or a Cognito bearer; this route
  // additionally accepts the cron secret, which the proxy exempts by path.
  if (!request.headers.get("cookie") && !bearerOk(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const summary = await runSync({ trigger: "scheduled", dryRun });
  return NextResponse.json(summary, { status: summary.status === "failed" ? 500 : 200 });
}
