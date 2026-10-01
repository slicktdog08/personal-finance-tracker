import { db } from "@/server/db";
import { syncEnrollments } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import { getProvider, isKnownProvider, type ProviderWebhookEvent } from "./provider";
import { getSyncSettings, stampWebhook } from "./settings";
import { markEnrollmentDisconnected, runSync } from "./sync";

// Provider-agnostic webhook handling, kept out of the route file so it can be exercised
// in tests without a Next request context. The route ACKs immediately and runs `work`
// via next/server `after()` so the provider never waits on a sync.

export interface WebhookOutcome {
  status: number;
  body: { ok: boolean; event?: string; reason?: string };
  // Deferred work (a sync run, a status flip). Null when nothing to do.
  work: (() => Promise<void>) | null;
}

export async function handleWebhook(providerId: string, rawBody: string, headers: Headers): Promise<WebhookOutcome> {
  if (!isKnownProvider(providerId)) {
    return { status: 404, body: { ok: false, reason: "unknown provider" }, work: null };
  }
  const provider = await getProvider(providerId);
  const event = provider.verifyWebhook(rawBody, headers);
  if (!event) return { status: 401, body: { ok: false, reason: "bad signature" }, work: null };

  await stampWebhook();
  const settings = await getSyncSettings();
  if (!settings.webhookEnabled) return { status: 200, body: { ok: true, event: event.type, reason: "webhooks disabled" }, work: null };

  return { status: 200, body: { ok: true, event: event.type }, work: workFor(providerId, event) };
}

function workFor(providerId: string, event: ProviderWebhookEvent): WebhookOutcome["work"] {
  switch (event.type) {
    case "transactions.processed":
      return async () => {
        const [enr] = await db
          .select({ id: syncEnrollments.id, status: syncEnrollments.status })
          .from(syncEnrollments)
          .where(and(eq(syncEnrollments.provider, providerId), eq(syncEnrollments.enrollmentId, event.enrollmentId)))
          .limit(1);
        if (!enr || enr.status !== "active") return;
        await runSync({ trigger: "webhook", enrollmentDbId: enr.id });
      };
    case "enrollment.disconnected":
      return async () => {
        await markEnrollmentDisconnected(providerId, event.enrollmentId, event.reason);
      };
    default:
      return null;
  }
}
