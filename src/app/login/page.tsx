import { LoginForm } from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in · Billing Tracker" };

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
  const sp = await searchParams;

  return (
    <div className="flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <LoginForm next={safeNext(sp.next)} />
      </div>
    </div>
  );
}
