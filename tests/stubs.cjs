/* eslint-disable @typescript-eslint/no-require-imports */
// Preload for running server code outside Next (tests + scripts/bank-sync.ts):
//   node --require ./tests/stubs.cjs ...   (via tsx)
// `server-only` is a Next build-time alias (no real package) and `next/cache` needs a
// request context, so both are redirected to local no-op modules. The DB and every sync
// module then run for real.
const Module = require("module");
const path = require("path");
const fs = require("fs");

// Load .env.local the way Next does for local runs. dotenv never overwrites an already-set
// variable, so an exported var (CI/Jenkins) still wins.
//
// This preload is shared with `npm run sync`, which talks to the REAL database on purpose,
// so it deliberately does not know about .env.test. Test runs get the test database by
// preloading ./tests/env-test.cjs *before* this file — see that file for why the order of
// the two is the whole ballgame.
const envLocal = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envLocal)) require("dotenv").config({ path: envLocal, quiet: true });
const STUBS = {
  "server-only": path.join(__dirname, "stubs", "server-only.cjs"),
  "next/cache": path.join(__dirname, "stubs", "next-cache.cjs"),
};
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (STUBS[request]) return STUBS[request];
  return orig.call(this, request, ...rest);
};
