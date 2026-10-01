/* eslint-disable @typescript-eslint/no-require-imports */
// Extra preload for page-level tests: bypasses Cognito. Never used by scripts/bank-sync.ts.
require("./stubs.cjs");
const Module = require("module");
const path = require("path");
const SESSION = path.join(__dirname, "stubs", "session.cjs");
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "@/server/auth/session" || /[\\/]src[\\/]server[\\/]auth[\\/]session(\.ts)?$/.test(request)) return SESSION;
  return orig.call(this, request, ...rest);
};
