"use server";

import { redirect } from "next/navigation";
import {
  ConfirmForgotPasswordCommand,
  ForgotPasswordCommand,
  InitiateAuthCommand,
  InvalidPasswordException,
  LimitExceededException,
  NotAuthorizedException,
  PasswordResetRequiredException,
  RespondToAuthChallengeCommand,
  RevokeTokenCommand,
  TooManyRequestsException,
  UserNotConfirmedException,
  UserNotFoundException,
  type AuthenticationResultType,
} from "@aws-sdk/client-cognito-identity-provider";
import { cognito, secretHash } from "@/server/auth/cognito";
import { COGNITO_CLIENT_ID } from "@/server/auth/config";
import {
  REFRESH_TOKEN_COOKIE,
  clearSessionCookies,
  setSessionCookies,
} from "@/server/auth/session";
import { cookies } from "next/headers";

/**
 * Deliberately vague. Cognito app clients default to "prevent user existence errors",
 * and we keep that property here rather than telling an attacker which half of the
 * credential pair was wrong.
 */
const GENERIC_CREDENTIALS_ERROR = "That email or password isn't right.";

export type SignInResult =
  | { ok: true }
  /**
   * Cognito issued a challenge instead of tokens. `session` is a short-lived,
   * single-use token that must be echoed back with the challenge response.
   */
  | { ok: false; challenge: "NEW_PASSWORD_REQUIRED"; session: string; username: string }
  | { ok: false; error: string };

function authParams(username: string, extra: Record<string, string>) {
  const hash = secretHash(username);
  return hash ? { ...extra, SECRET_HASH: hash } : extra;
}

async function persist(result: AuthenticationResultType | undefined): Promise<boolean> {
  if (!result?.AccessToken || !result.IdToken) return false;
  await setSessionCookies({
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    refreshToken: result.RefreshToken,
  });
  return true;
}

/** Maps Cognito's exception types onto messages that are safe to show a visitor. */
function describeAuthError(error: unknown): string {
  if (error instanceof NotAuthorizedException || error instanceof UserNotFoundException) {
    return GENERIC_CREDENTIALS_ERROR;
  }
  if (error instanceof PasswordResetRequiredException) {
    return "Your password needs to be reset. Use “Forgot password” below.";
  }
  if (error instanceof UserNotConfirmedException) {
    return "This account isn't confirmed yet. Confirm it in the Cognito console.";
  }
  if (error instanceof InvalidPasswordException) {
    return error.message || "That password doesn't meet the pool's password policy.";
  }
  if (error instanceof TooManyRequestsException || error instanceof LimitExceededException) {
    return "Too many attempts. Wait a minute and try again.";
  }
  console.error("[auth] unexpected Cognito error", error);
  return "Couldn't sign you in right now. Try again.";
}

export async function signIn(input: {
  email: string;
  password: string;
}): Promise<SignInResult> {
  const username = input.email.trim().toLowerCase();
  if (!username || !input.password) {
    return { ok: false, error: "Enter your email and password." };
  }

  try {
    const response = await cognito.send(
      new InitiateAuthCommand({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: COGNITO_CLIENT_ID,
        AuthParameters: authParams(username, {
          USERNAME: username,
          PASSWORD: input.password,
        }),
      }),
    );

    if (response.ChallengeName === "NEW_PASSWORD_REQUIRED" && response.Session) {
      return {
        ok: false,
        challenge: "NEW_PASSWORD_REQUIRED",
        session: response.Session,
        username,
      };
    }

    if (response.ChallengeName) {
      // MFA and custom challenges aren't wired up; fail closed and say so plainly
      // rather than dropping the user on a screen that can't complete the flow.
      return {
        ok: false,
        error: `This account requires the ${response.ChallengeName} challenge, which this app doesn't support yet.`,
      };
    }

    if (!(await persist(response.AuthenticationResult))) {
      return { ok: false, error: "Cognito didn't return a usable session. Try again." };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeAuthError(error) };
  }
}

/**
 * Completes the first-sign-in flow for a user created in the Cognito console with a
 * temporary password.
 */
export async function completeNewPassword(input: {
  username: string;
  session: string;
  newPassword: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!input.newPassword) return { ok: false, error: "Enter a new password." };

  try {
    const response = await cognito.send(
      new RespondToAuthChallengeCommand({
        ClientId: COGNITO_CLIENT_ID,
        ChallengeName: "NEW_PASSWORD_REQUIRED",
        Session: input.session,
        ChallengeResponses: authParams(input.username, {
          USERNAME: input.username,
          NEW_PASSWORD: input.newPassword,
        }),
      }),
    );

    if (response.ChallengeName) {
      return {
        ok: false,
        error: `Cognito returned an unsupported follow-up challenge (${response.ChallengeName}).`,
      };
    }
    if (!(await persist(response.AuthenticationResult))) {
      return { ok: false, error: "Password was set but no session came back. Sign in again." };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeAuthError(error) };
  }
}

/**
 * Always reports success. Whether or not the address maps to a real user is exactly
 * the fact an enumeration attack is fishing for.
 */
export async function requestPasswordReset(input: {
  email: string;
}): Promise<{ ok: boolean; error?: string }> {
  const username = input.email.trim().toLowerCase();
  if (!username) return { ok: false, error: "Enter your email." };

  try {
    await cognito.send(
      new ForgotPasswordCommand({
        ClientId: COGNITO_CLIENT_ID,
        Username: username,
        ...(secretHash(username) ? { SecretHash: secretHash(username) } : {}),
      }),
    );
  } catch (error) {
    if (error instanceof TooManyRequestsException || error instanceof LimitExceededException) {
      return { ok: false, error: "Too many attempts. Wait a minute and try again." };
    }
    // Swallow everything else — including UserNotFoundException — on purpose.
    if (!(error instanceof UserNotFoundException)) {
      console.error("[auth] password reset request failed", error);
    }
  }
  return { ok: true };
}

export async function confirmPasswordReset(input: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<{ ok: boolean; error?: string }> {
  const username = input.email.trim().toLowerCase();
  const code = input.code.trim();
  if (!username || !code || !input.newPassword) {
    return { ok: false, error: "Fill in the code and your new password." };
  }

  try {
    await cognito.send(
      new ConfirmForgotPasswordCommand({
        ClientId: COGNITO_CLIENT_ID,
        Username: username,
        ConfirmationCode: code,
        Password: input.newPassword,
        ...(secretHash(username) ? { SecretHash: secretHash(username) } : {}),
      }),
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof NotAuthorizedException) {
      return { ok: false, error: "That code has expired. Request a new one." };
    }
    return { ok: false, error: describeAuthError(error) };
  }
}

/**
 * Revokes the refresh token at Cognito before dropping the cookies, so a token that
 * was somehow captured can't be replayed after sign-out.
 */
export async function signOut(): Promise<never> {
  const store = await cookies();
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;

  if (refreshToken) {
    try {
      await cognito.send(
        new RevokeTokenCommand({ ClientId: COGNITO_CLIENT_ID, Token: refreshToken }),
      );
    } catch (error) {
      // Revocation is best-effort; clearing the cookies is the part that must happen.
      console.error("[auth] token revocation failed", error);
    }
  }

  await clearSessionCookies();
  redirect("/login");
}
