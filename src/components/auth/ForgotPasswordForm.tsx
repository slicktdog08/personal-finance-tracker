"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmPasswordReset, requestPasswordReset } from "@/server/actions/auth";

const inputCls = "mp-input";

const buttonCls = "mp-btn mp-btn--primary mp-btn--lg mp-btn--block";

export function ForgotPasswordForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Step 1 collects the address; step 2 collects the emailed code and new password.
  const [stage, setStage] = useState<"request" | "confirm">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const request = () => {
    setError(null);
    start(async () => {
      const res = await requestPasswordReset({ email });
      if (!res.ok) {
        setError(res.error ?? "Couldn't send a code.");
        return;
      }
      // Always advances, even for an unknown address — the response deliberately
      // doesn't reveal whether an account exists.
      setStage("confirm");
    });
  };

  const confirm = () => {
    setError(null);
    start(async () => {
      const res = await confirmPasswordReset({ email, code, newPassword });
      if (!res.ok) {
        setError(res.error ?? "Couldn't reset that password.");
        return;
      }
      setDone(true);
      router.replace("/login");
    });
  };

  if (done) {
    return (
      <p className="text-sm text-fg-2">
        Password updated.{" "}
        <Link href="/login" className="font-medium text-accent-text hover:underline">
          Sign in
        </Link>
        .
      </p>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (stage === "request") request();
        else confirm();
      }}
    >
      <div>
        <h1 className="font-display text-lg font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-fg-2">
          {stage === "request"
            ? "We'll email you a verification code."
            : `Enter the code sent to ${email} and pick a new password.`}
        </p>
      </div>

      <div className="space-y-1">
        <label className="mp-field__label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          className={inputCls}
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={stage === "confirm"}
          required
        />
      </div>

      {stage === "confirm" && (
        <>
          <div className="space-y-1">
            <label className="mp-field__label" htmlFor="code">
              Verification code
            </label>
            <input
              id="code"
              className={inputCls}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <label className="mp-field__label" htmlFor="new-password">
              New password
            </label>
            <input
              id="new-password"
              className={inputCls}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
        </>
      )}

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      <button className={buttonCls} type="submit" disabled={pending}>
        {pending
          ? "Working…"
          : stage === "request"
            ? "Send code"
            : "Reset password"}
      </button>

      <p className="text-center text-sm">
        <Link href="/login" className="text-fg-2 hover:text-accent-text hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
