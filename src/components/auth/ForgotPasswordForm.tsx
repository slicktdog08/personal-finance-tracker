"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmPasswordReset, requestPasswordReset } from "@/server/actions/auth";

const inputCls =
  "w-full border rounded px-3 py-2 text-sm bg-transparent border-neutral-300 dark:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-neutral-100";

const buttonCls =
  "w-full rounded px-3 py-2 text-sm font-medium bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 disabled:opacity-50";

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
      <p className="text-sm">
        Password updated.{" "}
        <Link href="/login" className="underline">
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
        <h1 className="text-lg font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {stage === "request"
            ? "We'll email you a verification code."
            : `Enter the code sent to ${email} and pick a new password.`}
        </p>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="email">
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
            <label className="text-sm font-medium" htmlFor="code">
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
            <label className="text-sm font-medium" htmlFor="new-password">
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

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button className={buttonCls} type="submit" disabled={pending}>
        {pending
          ? "Working…"
          : stage === "request"
            ? "Send code"
            : "Reset password"}
      </button>

      <p className="text-center text-sm">
        <Link href="/login" className="text-neutral-600 hover:underline dark:text-neutral-400">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
