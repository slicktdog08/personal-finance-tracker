import { NextResponse } from "next/server";
import { requireApiAuth } from "@/server/auth/api";

// Session state is per-request and must never be cached or prerendered.
export const dynamic = "force-dynamic";

/**
 * Returns the caller's identity, or 401. Doubles as the reference implementation for
 * protecting a Route Handler — copy the two-line guard into any new endpoint.
 */
export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json(
    {
      userId: auth.session.userId,
      username: auth.session.username,
      email: auth.session.email ?? null,
      name: auth.session.name ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
