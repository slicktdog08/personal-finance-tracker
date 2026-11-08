"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPlaidLinkToken, finishPlaidLink } from "@/server/actions/plaid";
import { clearPendingLink, describeExit, openPlaidLink, rememberPendingLink, takePendingLink, type LinkOutcome } from "@/lib/plaid-link";
import { Button, Notice } from "@/components/ds";

type Msg = { kind: "ok" | "err"; text: string } | null;

// Shared by the button and the OAuth return page: Link's result → server.
async function complete(outcome: LinkOutcome, reconnectEnrollmentDbId: number | undefined): Promise<Msg> {
  if (outcome.kind === "exit") {
    const why = describeExit(outcome.error);
    return why ? { kind: "err", text: why } : null;
  }
  const res = await finishPlaidLink({
    publicToken: outcome.publicToken,
    institutionId: outcome.metadata.institution?.institution_id ?? null,
    institutionName: outcome.metadata.institution?.name ?? null,
    reconnectEnrollmentDbId,
  });
  if (!res.ok) return { kind: "err", text: res.error };
  if (reconnectEnrollmentDbId != null) return { kind: "ok", text: "Reconnected." };
  const v = res.value!;
  return {
    kind: "ok",
    text: `Linked ${outcome.metadata.institution?.name ?? "the bank"}. ${v.mapped} account${v.mapped === 1 ? "" : "s"} matched by last four (check and turn on below), ${v.unmapped} to map. The first sync can take a few minutes while Plaid pulls history.`,
  };
}

// "Link with Plaid" (new Item) or "Reconnect" (update mode on an existing Item).
export function PlaidLinkButton({
  reconnectEnrollmentDbId,
  label,
  urgent = false,
}: {
  reconnectEnrollmentDbId?: number;
  label?: string;
  // Reconnect on a disconnected Item: shown as the primary action.
  urgent?: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  // Set when Plaid refused the OAuth redirect URI (not registered in the dashboard).
  const [oauthWarning, setOauthWarning] = useState<string | null>(null);
  const reconnect = reconnectEnrollmentDbId != null;

  const go = () => {
    setMsg(null);
    setOauthWarning(null);
    start(async () => {
      const tok = await createPlaidLinkToken({ reconnectEnrollmentDbId });
      if (!tok.ok) {
        setMsg({ kind: "err", text: tok.error });
        return;
      }
      const { linkToken, oauthUnavailable } = tok.value!;
      if (oauthUnavailable) {
        setOauthWarning(
          `Banks that sign in on their own site (Chase, Capital One, Bank of America, Schwab) can't finish: add ${oauthUnavailable.redirectUri} to Allowed redirect URIs in the Plaid dashboard.`,
        );
      }
      rememberPendingLink({ linkToken, reconnectEnrollmentDbId });
      let outcome: LinkOutcome;
      try {
        outcome = await openPlaidLink(linkToken);
      } catch (e) {
        clearPendingLink();
        setMsg({ kind: "err", text: (e as Error).message });
        return;
      }
      clearPendingLink();
      setMsg(await complete(outcome, reconnectEnrollmentDbId));
      router.refresh();
    });
  };

  const button = (
    <Button
      icon="link"
      size={reconnect ? "sm" : "md"}
      variant={reconnect && !urgent ? "secondary" : "primary"}
      loading={busy}
      onClick={go}
      title={reconnect ? "Sign in to the bank again through Plaid; account mappings are kept." : undefined}
    >
      {busy ? "Opening Plaid…" : (label ?? (reconnect ? "Reconnect" : "Link bank"))}
    </Button>
  );
  if (!msg && !oauthWarning) return button;
  return (
    <span className="inline-flex flex-col items-start gap-2">
      {button}
      {msg && (
        <Notice tone={msg.kind === "ok" ? "ok" : "danger"} className="break-words">
          {msg.text}
        </Notice>
      )}
      {oauthWarning && (
        <Notice tone="warn" className="break-words">
          {oauthWarning}
        </Notice>
      )}
    </span>
  );
}

// /settings/sync/plaid-oauth: the bank sent the browser back here. Re-open Link with the same
// link token and this URL so it can finish, then return to the settings page.
export function PlaidOAuthResume() {
  const router = useRouter();
  const started = useRef(false);
  const [msg, setMsg] = useState<Msg>({ kind: "ok", text: "Finishing the bank connection…" });

  useEffect(() => {
    if (started.current) return; // StrictMode double-invoke
    started.current = true;
    const pending = takePendingLink();
    if (!pending) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot outcome of a browser-only lookup
      setMsg({ kind: "err", text: "This link session expired or was started in another browser. Start again from Bank Sync." });
      return;
    }
    (async () => {
      let outcome: LinkOutcome;
      try {
        outcome = await openPlaidLink(pending.linkToken, window.location.href);
      } catch (e) {
        setMsg({ kind: "err", text: (e as Error).message });
        return;
      } finally {
        clearPendingLink();
      }
      const result = await complete(outcome, pending.reconnectEnrollmentDbId);
      if (result?.kind === "err") {
        setMsg(result);
        return;
      }
      router.replace("/settings/sync");
      router.refresh();
    })();
  }, [router]);

  if (!msg) return null;
  return <Notice tone={msg.kind === "err" ? "danger" : "info"}>{msg.text}</Notice>;
}
