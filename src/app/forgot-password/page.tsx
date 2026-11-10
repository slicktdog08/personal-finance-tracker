import { BrandMark, Wordmark } from "@/components/ds";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { authProvider, isDemoMode } from "@/server/auth/provider";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <div className="flex items-center justify-center px-4 py-12 sm:py-20">
      <div className="grid w-full max-w-sm gap-6">
        <div className="grid justify-items-center gap-3">
          <BrandMark size={52} />
          <Wordmark size={30} />
          <div className="text-sm text-fg-3">Cuentas claras.</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-6 shadow-hairline">
          {authProvider() === "cognito" ? <ForgotPasswordForm /> : <LocalReset demo={isDemoMode()} />}
        </div>
        <p className="text-center text-xs text-fg-3">Private, single-user. Your data stays on your server.</p>
      </div>
    </div>
  );
}

/**
 * Built-in auth has no mail server to send a reset code through, and for a single-user app
 * the owner already has the server. So the reset is a command, not an email.
 */
function LocalReset({ demo }: { demo: boolean }) {
  return (
    <div className="space-y-3 text-sm text-fg-2">
      <h1 className="font-display text-lg font-semibold tracking-tight text-fg">Reset your password</h1>
      {demo ? (
        <p>The demo account&apos;s password is filled in on the sign-in screen.</p>
      ) : (
        <>
          <p>This install uses built-in accounts, so the password is reset from the server it runs on:</p>
          <pre className="overflow-x-auto rounded-md border border-line bg-sunken p-3 font-mono text-xs text-fg">npm run auth -- passwd you@example.com</pre>
          <p>
            In Docker, run it inside the container:{" "}
            <code className="font-mono text-xs">docker compose exec app npm run auth -- passwd you@example.com</code>
          </p>
        </>
      )}
      <p>
        <Link href="/login" className="font-medium text-accent-text hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
