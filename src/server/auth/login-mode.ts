import "server-only";
import { authProvider, isDemoMode } from "./provider";
import type { LoginMode } from "./types";

/** What the login screen should render. Reads the database only for built-in auth. */
export async function getLoginMode(): Promise<LoginMode> {
  if (authProvider() === "cognito") return { kind: "cognito" };
  const local = await import("./local/flows");
  if (isDemoMode()) {
    await local.ensureDemoUser();
    return { kind: "demo", ...local.demoCredentials() };
  }
  return { kind: "local", firstRun: await local.isFirstRun() };
}
