export function SetupNotice({ error }: { error?: string }) {
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
          Put a real connection string in <code className="font-mono">.env.local</code>{" "}
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
      {error ? (
        <pre className="mt-3 text-xs bg-amber-100 dark:bg-amber-900/40 p-2 rounded overflow-x-auto">
          {error}
        </pre>
      ) : null}
    </div>
  );
}
