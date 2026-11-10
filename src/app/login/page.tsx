import { BrandMark, Wordmark } from "@/components/ds";
import { LoginForm } from "@/components/auth/LoginForm";
import { getLoginMode } from "@/server/auth/login-mode";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

type SP = Record<string, string | string[] | undefined>;

/**
 * Re-validates the `next` destination server-side. The proxy already writes only safe
 * values, but this page is directly addressable, so anyone can put anything in the
 * query string — an absolute or protocol-relative URL here would be an open redirect.
 */
function safeNext(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const [sp, mode] = await Promise.all([searchParams, getLoginMode()]);

  return (
    <div className="flex items-center justify-center px-4 py-12 sm:py-20">
      <div className="grid w-full max-w-sm gap-6">
        <div className="grid justify-items-center gap-3">
          <BrandMark size={52} />
          <Wordmark size={30} />
          <div className="text-sm text-fg-3">Cuentas claras.</div>
        </div>
        <div className="rounded-card border border-line bg-surface p-6 shadow-hairline">
          <LoginForm next={safeNext(sp.next)} mode={mode} />
        </div>
        <p className="text-center text-xs text-fg-3">
          {mode.kind === "demo"
            ? "Public demo. Nothing here is real, so poke at anything."
            : "Private, single-user. Your data stays on your server."}
        </p>
      </div>
    </div>
  );
}
