/* eslint-disable @typescript-eslint/no-require-imports */
// Points a test run at the throwaway database in .env.test.
//
// Preloaded BEFORE ./tests/stubs.cjs, and that order is the whole mechanism: dotenv never
// overwrites a variable that is already set, so the file loaded first wins. stubs.cjs
// loads .env.local — which is production — so anything that needs to override it has to
// get there first.
//
//   node --require ./tests/env-test.cjs --require ./tests/stubs.cjs ...
//
// This used to live inside stubs.cjs as a second dotenv call after .env.local, where it
// could never take effect. The e2e suite consequently ran against the production database
// for its whole life. Keep the two files separate: stubs.cjs is also the preload for
// `npm run sync`, which must keep talking to the real database.
const path = require("path");
const fs = require("fs");

const envTest = path.join(__dirname, "..", ".env.test");
if (!fs.existsSync(envTest)) {
  console.error(
    "\n✗ .env.test not found.\n" +
      "  The test suite needs its own database — it creates, mutates and deletes rows.\n" +
      "  Set it up once:\n" +
      "      cp .env.test.example .env.test\n" +
      "      npm run db:test:up\n",
  );
  process.exit(1);
}
require("dotenv").config({ path: envTest, quiet: true });

// Then refuse to hand a non-local database to a test process at all.
//
// tests/e2e/helpers.ts checks this too, but only from setupFixtures(), so a test file that
// queries the database before calling it — or a new file that forgets to — would slip past.
// Here it is a property of the process: nothing has imported @/server/db yet, so there is no
// pool and no query that can precede the check.
// Same "split on the LAST @" rule as src/server/lib/db-url.ts, so a password containing '@'
// does not make a remote host look local. Kept inline: this file must not import from src/.
const hostOf = (url) => {
  const rest = String(url || "").replace(/^mysql2?:\/\//i, "");
  const hostpart = rest.slice(rest.lastIndexOf("@") + 1).split("?")[0];
  return hostpart.split("/")[0].replace(/:\d+$/, "");
};

const host = hostOf(process.env.DATABASE_URL);
const LOCAL = ["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"];

if (!LOCAL.includes(host)) {
  // The app's own database is never a legal target, override or not. .env.local is by
  // definition where the real money lives, so if .env.test has drifted onto the same host
  // there is nothing to weigh up — no test run wants that, and an escape hatch that can
  // reach it is the hole this whole change exists to close.
  const appEnv = path.join(__dirname, "..", ".env.local");
  const appHost = fs.existsSync(appEnv)
    ? hostOf((/^\s*DATABASE_URL\s*=\s*"?([^"\n]*)"?/m.exec(fs.readFileSync(appEnv, "utf8")) || [])[1])
    : "";
  if (appHost && host === appHost) {
    console.error(
      `\n✗ .env.test points at the same host as .env.local (${host}) — that is the live database.\n\n` +
        `  The suite creates, mutates and deletes rows. There is no override for this case.\n` +
        `  Point .env.test at the throwaway container instead:\n\n` +
        `      npm run db:test:up          # MySQL on 127.0.0.1:3307\n` +
        `      cp .env.test.example .env.test\n`,
    );
    process.exit(1);
  }

  // Otherwise an override is allowed, but it has to name the host it is unlocking. A bare
  // "=1" is too easy to leave exported in a shell or paste into the wrong command — typing
  // the host out is the point, because that is the moment you check which one it is.
  if (process.env.E2E_ALLOW_REMOTE_DB === host) {
    console.warn(`\n⚠  E2E_ALLOW_REMOTE_DB=${host} — tests will create and delete rows there.\n`);
  } else {
    const given = process.env.E2E_ALLOW_REMOTE_DB;
    console.error(
      `\n✗ Refusing to run tests against a non-local database: ${host}\n\n` +
        (given
          ? `  E2E_ALLOW_REMOTE_DB is set to "${given}", which does not match ${host}.\n\n`
          : `  .env.test points off the loopback. The suite creates, mutates and deletes rows.\n\n`) +
        `      npm run db:test:up          # throwaway MySQL on 127.0.0.1:3307\n` +
        `      grep DATABASE_URL .env.test # should say 127.0.0.1:3307\n\n` +
        `  To allow it anyway, name the host:  E2E_ALLOW_REMOTE_DB=${host}\n`,
    );
    process.exit(1);
  }
}
