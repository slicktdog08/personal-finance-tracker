"use client";

import { useState, useTransition } from "react";
import { linkSimplefin } from "@/server/actions/sync";
import { Button, Input, Notice } from "@/components/ds";

// Paste-a-token link flow for SimpleFIN Bridge. New links and reconnects share it; a
// reconnect passes the existing enrollment so its account mappings are kept.
// With `envToken`, an empty box links using SIMPLE_FIN_SETUP_TOKEN from the server's env.
export function LinkSimplefin({
  reconnectEnrollmentDbId,
  envToken = false,
  onDone,
}: {
  reconnectEnrollmentDbId?: number;
  envToken?: boolean;
  onDone?: () => void;
}) {
  const [busy, start] = useTransition();
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const reconnect = reconnectEnrollmentDbId != null;

  const submit = () => {
    setMsg(null);
    start(async () => {
      const res = await linkSimplefin({ token, reconnectEnrollmentDbId });
      if (!res.ok) {
        setMsg({ kind: "err", text: res.error });
        return;
      }
      setToken("");
      const v = res.value!;
      setMsg({
        kind: "ok",
        text: reconnect
          ? "Reconnected."
          : `Linked. ${v.mapped} account${v.mapped === 1 ? "" : "s"} matched by last four (check and turn on below), ${v.unmapped} to map.`,
      });
      onDone?.();
    });
  };

  return (
    <div className="space-y-2">
      {!reconnect && (
        <p className="text-sm text-fg-2">
          In{" "}
          <a href="https://bridge.simplefin.org/" target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
            SimpleFIN Bridge
          </a>
          , connect your banks, then create a <span className="font-medium">Setup Token</span> for this app and paste it
          here. Bridge refreshes from the banks about once a day.
        </p>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={envToken ? "Leave empty to use SIMPLE_FIN_SETUP_TOKEN" : reconnect ? "New Setup Token" : "Setup Token"}
          aria-label={reconnect ? "New Setup Token" : "Setup Token"}
          className="min-w-0 flex-1 font-mono"
        />
        <Button icon="link" loading={busy} disabled={busy || (!token.trim() && !envToken)} onClick={submit}>
          {busy ? "Linking…" : reconnect ? "Reconnect bank" : "Link bank"}
        </Button>
      </div>
      {msg && (
        <Notice tone={msg.kind === "ok" ? "ok" : "danger"} className="break-words">
          {msg.text}
        </Notice>
      )}
    </div>
  );
}
