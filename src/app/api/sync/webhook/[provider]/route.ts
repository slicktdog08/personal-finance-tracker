import { after, NextResponse, type NextRequest } from "next/server";
import { handleWebhook } from "@/server/lib/sync/webhook";

// Inbound provider webhooks ("new transactions", "enrollment broken"). Public in the proxy
// allowlist — authentication is the provider's HMAC signature over the raw body, verified
// in the provider adapter. Respond first, sync after.
export const dynamic = "force-dynamic";

// The params type is written out rather than using Next's generated `RouteContext<…>`: that
// helper only exists in .next/types, so a cold `tsc --noEmit` (no build yet) couldn't resolve it.
export async function POST(request: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const raw = await request.text();
  let outcome;
  try {
    outcome = await handleWebhook(provider, raw, request.headers);
  } catch (e) {
    // Public, unauthenticated path: never leak a stack trace, never crash the request.
    console.error(`[sync] webhook handling failed (${provider}):`, e);
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (outcome.work) {
    const work = outcome.work;
    after(async () => {
      try {
        await work();
      } catch (e) {
        console.error(`[sync] webhook work failed (${provider}):`, e);
      }
    });
  }
  return NextResponse.json(outcome.body, { status: outcome.status });
}
