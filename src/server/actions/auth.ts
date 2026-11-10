"use server";

import { redirect } from "next/navigation";
import { authProvider } from "@/server/auth/provider";
import { clearSessionCookies } from "@/server/auth/session";
import type { SignInResult } from "@/server/auth/types";

/**
 * Sign-in actions. Each one hands off to whichever backend this install uses — built-in
 * accounts or AWS Cognito (src/server/auth/provider.ts). The backends are imported lazily
 * so the one that isn't configured is never loaded.
 */
const cognito = () => import("@/server/auth/cognito/flows");
const local = () => import("@/server/auth/local/flows");
const isCognito = () => authProvider() === "cognito";

const COGNITO_ONLY = "That only applies when sign-in is handled by Cognito.";

export async function signIn(input: { email: string; password: string }): Promise<SignInResult> {
  return isCognito() ? (await cognito()).signIn(input) : (await local()).signIn(input);
}

/**
 * First-run setup for built-in auth: creates the owner's account and signs them in. Refuses
 * once any account exists, so it can't be used to add a second user or take over an install.
 */
export async function createFirstUser(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<SignInResult> {
  if (isCognito()) return { ok: false, error: "Accounts are managed in your Cognito user pool." };
  return (await local()).createFirstUser(input);
}

/** Cognito only: finishes the first sign-in of a user created with a temporary password. */
export async function completeNewPassword(input: {
  username: string;
  session: string;
  newPassword: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isCognito()) return { ok: false, error: COGNITO_ONLY };
  return (await cognito()).completeNewPassword(input);
}

/**
 * Cognito only. Built-in auth has no mail server to send a code through; its password is
 * reset from the server's command line (`npm run auth -- passwd`), which the page explains.
 */
export async function requestPasswordReset(input: { email: string }): Promise<{ ok: boolean; error?: string }> {
  if (!isCognito()) return { ok: false, error: COGNITO_ONLY };
  return (await cognito()).requestPasswordReset(input);
}

export async function confirmPasswordReset(input: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isCognito()) return { ok: false, error: COGNITO_ONLY };
  return (await cognito()).confirmPasswordReset(input);
}

export async function signOut(): Promise<never> {
  // Cognito revokes the refresh token server-side first. Built-in sessions are stateless,
  // so dropping the cookies is the whole sign-out.
  if (isCognito()) await (await cognito()).signOut();
  await clearSessionCookies();
  redirect("/login");
}
