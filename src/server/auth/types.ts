/** Shapes shared by both sign-in backends and the login form. Types only. */

export type SignInResult =
  | { ok: true }
  /**
   * Cognito issued a challenge instead of tokens (an admin-created user's first sign-in).
   * `session` is a short-lived, single-use token echoed back with the challenge response.
   * The built-in backend never returns this.
   */
  | { ok: false; challenge: "NEW_PASSWORD_REQUIRED"; session: string; username: string }
  | { ok: false; error: string };

export type VerifiedAccessToken = {
  sub: string;
  username: string;
  /** App client the token was minted for ("local" for built-in sessions). */
  clientId: string;
  /** Space-separated OAuth scopes (empty for password sign-ins). */
  scope: string;
  /** Unix seconds. */
  exp: number;
};

export type VerifiedIdToken = {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  exp: number;
};

export type RefreshResult =
  | { ok: true; accessToken: string; idToken: string }
  /** The refresh token is expired or revoked — the user must sign in again. */
  | { ok: false; reason: "invalid" }
  /** The backend was unreachable or errored; the existing session should be left alone. */
  | { ok: false; reason: "error" };

/** What the login screen needs to know before it renders. */
export type LoginMode =
  | { kind: "cognito" }
  /** Built-in auth; `firstRun` means no account exists yet and the form creates one. */
  | { kind: "local"; firstRun: boolean }
  /** Public demo: the form arrives filled in with the shared demo account. */
  | { kind: "demo"; email: string; password: string };
