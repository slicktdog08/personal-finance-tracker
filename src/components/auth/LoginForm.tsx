"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeNewPassword, signIn } from "@/server/actions/auth";

const inputCls =
  "w-full border rounded px-3 py-2 text-sm bg-transparent border-neutral-300 dark:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-neutral-100";

const buttonCls =
  "w-full rounded px-3 py-2 text-sm font-medium bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 disabled:opacity-50";

/** Set by Cognito when an admin-created user signs in with a temporary password. */
type Challenge = { session: string; username: string };

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // The session cookie is set by the Server Action, so a refresh is what makes the
  // freshly-authenticated layout and proxy see it.
  const enter = () => {
    router.replace(next);
    router.refresh();
  };

  const submitCredentials = () => {
    setError(null);
    start(async () => {
      const res = await signIn({ email, password });
      if (res.ok) return enter();
      if ("challenge" in res) {
        setChallenge({ session: res.session, username: res.username });
        return;
      }
      setError(res.error);
    });
  };

  const submitNewPassword = () => {
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Those passwords don't match.");
      return;
    }
    start(async () => {
      const res = await completeNewPassword({
        username: challenge!.username,
        session: challenge!.session,
        newPassword,
      });
      if (res.ok) return enter();
      setError(res.error ?? "Couldn't set that password.");
      // A consumed or expired challenge session can't be retried — start over.
      if (res.error?.includes("expired")) setChallenge(null);
    });
  };

  if (challenge) {
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submitNewPassword();
        }}
      >
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Choose a new password</h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            This account still has its temporary password. Set a permanent one to continue.
          </p>
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

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="confirm-password">
            Confirm password
          </label>
          <input
            id="confirm-password"
            className={inputCls}
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button className={buttonCls} type="submit" disabled={pending}>
          {pending ? "Saving…" : "Set password and sign in"}
        </button>
      </form>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submitCredentials();
      }}
    >
      <div>
        <h1 className="text-lg font-semibold tracking-tight">💳 Billing</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Sign in to continue.
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
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className={inputCls}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button className={buttonCls} type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-center text-sm">
        <Link
          href="/forgot-password"
          className="text-neutral-600 hover:underline dark:text-neutral-400"
        >
          Forgot password?
        </Link>
      </p>
    </form>
  );
}
