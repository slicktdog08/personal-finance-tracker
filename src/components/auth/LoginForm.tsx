"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeNewPassword, createFirstUser, signIn } from "@/server/actions/auth";
import type { LoginMode } from "@/server/auth/types";

const inputCls = "mp-input";

const buttonCls = "mp-btn mp-btn--primary mp-btn--lg mp-btn--block";

/** Set by Cognito when an admin-created user signs in with a temporary password. */
type Challenge = { session: string; username: string };

export function LoginForm({ next, mode }: { next: string; mode: LoginMode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const demo = mode.kind === "demo" ? mode : null;
  // Built-in auth with no account yet: this same screen creates the owner's account.
  const firstRun = mode.kind === "local" && mode.firstRun;

  const [email, setEmail] = useState(demo?.email ?? "");
  const [password, setPassword] = useState(demo?.password ?? "");
  const [name, setName] = useState("");

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
    if (firstRun && password !== confirmPassword) {
      setError("Those passwords don't match.");
      return;
    }
    start(async () => {
      const res = firstRun ? await createFirstUser({ email, password, name }) : await signIn({ email, password });
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
          <h1 className="font-display text-lg font-semibold tracking-tight">Choose a new password</h1>
          <p className="mt-1 text-sm text-fg-2">
            This account still has its temporary password. Set a permanent one to continue.
          </p>
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

        <div className="space-y-1">
          <label className="mp-field__label" htmlFor="confirm-password">
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

        {error && <p className="text-sm text-danger" role="alert">{error}</p>}

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
        <h1 className="font-display text-lg font-semibold tracking-tight">
          {firstRun ? "Create your account" : demo ? "Try the demo" : "Sign in"}
        </h1>
        {firstRun && (
          <p className="mt-1 text-sm text-fg-2">
            Welcome. This install has no account yet — the one you create here is the owner, and the only one.
          </p>
        )}
        {demo && (
          <p className="mt-1 text-sm text-fg-2">
            The demo account is filled in for you. Everything inside is made-up data, and it resets regularly.
          </p>
        )}
      </div>

      {firstRun && (
        <div className="space-y-1">
          <label className="mp-field__label" htmlFor="name">
            Name <span className="text-fg-3">(optional)</span>
          </label>
          <input
            id="name"
            className={inputCls}
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      )}

      <div className="space-y-1">
        <label className="mp-field__label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          className={inputCls}
          type="email"
          autoComplete="username"
          autoFocus={!demo}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div className="space-y-1">
        <label className="mp-field__label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className={inputCls}
          type="password"
          autoComplete={firstRun ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={firstRun ? 8 : undefined}
          required
        />
        {firstRun && <p className="text-xs text-fg-3">At least 8 characters.</p>}
      </div>

      {firstRun && (
        <div className="space-y-1">
          <label className="mp-field__label" htmlFor="confirm-password">
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
      )}

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      <button className={buttonCls} type="submit" disabled={pending} autoFocus={!!demo}>
        {firstRun
          ? pending
            ? "Creating…"
            : "Create account"
          : pending
            ? "Signing in…"
            : demo
              ? "Enter the demo"
              : "Sign in"}
      </button>

      {!firstRun && !demo && (
        <p className="text-center text-sm">
          <Link
            href="/forgot-password"
            className="text-fg-2 hover:text-accent-text hover:underline"
          >
            Forgot password?
          </Link>
        </p>
      )}
    </form>
  );
}
