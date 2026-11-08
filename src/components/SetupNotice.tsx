import { parseDbUrl } from "@/server/lib/db-url";

// What the app is actually trying to connect to, minus the password, so a failed
// deploy says which host/user/options it used instead of just "not reachable".
function describeDbConfig(): { rows: [string, string][]; problem?: string } {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return { rows: [], problem: "DATABASE_URL is not set." };
  try {
    const { host, port, user, database } = parseDbUrl(url);
    const q = url.indexOf("?", url.lastIndexOf("@"));
    return {
      rows: [
        ["Host", `${host}:${port}`],
        ["User", user || "(none)"],
        ["Database", database || "(none)"],
        ["Options", q === -1 ? "(none)" : url.slice(q + 1)],
      ],
    };
  } catch (e) {
    return { rows: [], problem: e instanceof Error ? e.message : String(e) };
  }
}

// Drizzle wraps driver errors as "Failed query: <sql>"; the reason it failed
// (ECONNREFUSED, ER_ACCESS_DENIED_ERROR, …) is on the innermost `cause`.
function rootCause(error: unknown): string | undefined {
  let e = error;
  while (e instanceof Error && e.cause) e = e.cause;
  if (e === error) return undefined;
  if (!(e instanceof Error)) return String(e);
  const code = (e as { code?: unknown }).code;
  return code ? `${code}: ${e.message}` : e.message;
}

export function SetupNotice({ error }: { error?: unknown }) {
  const config = describeDbConfig();
  const cause = error === undefined ? undefined : rootCause(error);
  const message =
    error === undefined ? undefined : error instanceof Error ? error.message : String(error);
  const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.local";

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-amber-900 dark:text-amber-200">
        Database not reachable yet
      </h2>
      <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
        The app could not connect to MySQL. To finish setup:
      </p>
      <ol className="mt-3 list-decimal list-inside text-sm text-amber-800 dark:text-amber-300 space-y-1">
        <li>
          Put a real connection string in <code className="font-mono">{envFile}</code>{" "}
          (<code className="font-mono">DATABASE_URL</code>).
        </li>
        <li>
          Create the schema: <code className="font-mono">npm run db:migrate</code> (or{" "}
          <code className="font-mono">db:push</code>).
        </li>
        <li>
          Load history: <code className="font-mono">npm run seed</code>.
        </li>
      </ol>
      <div className="mt-4 text-sm text-amber-900 dark:text-amber-200">
        <h3 className="font-semibold">
          Connection in use <span className="font-normal">(password hidden)</span>
        </h3>
        {config.problem ? (
          <p className="mt-1 text-amber-800 dark:text-amber-300">{config.problem}</p>
        ) : (
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {config.rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-amber-800 dark:text-amber-300">{label}</dt>
                <dd className="font-mono break-all">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {cause ? (
        <p className="mt-3 text-sm font-mono break-all text-amber-900 dark:text-amber-200">
          {cause}
        </p>
      ) : null}
      {message ? (
        <pre className="mt-3 text-xs bg-amber-100 dark:bg-amber-900/40 p-2 rounded overflow-x-auto">
          {message}
        </pre>
      ) : null}
    </div>
  );
}
