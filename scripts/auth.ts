/**
 * Manages built-in sign-in accounts (AUTH_PROVIDER=local) from the command line.
 *
 *   npm run auth -- create you@example.com        create the account (prompts for a password)
 *   npm run auth -- passwd you@example.com        set a new password (signs every session out)
 *   npm run auth -- list                          show accounts
 *   npm run auth -- token you@example.com [days]  mint a bearer token for a non-browser client
 *                                                 (Claude Code's MCP connection); default 90 days
 *
 * The password is read from the terminal without echo, or from AUTH_PASSWORD when set
 * (for scripted setups). The first account can also be created in the browser: with no
 * account yet, the login page becomes a "Create your account" form.
 *
 * Run through `npm run auth`, which preloads tests/stubs.cjs so server modules import
 * outside Next (the same arrangement as `npm run sync`).
 */
import { createInterface } from "node:readline";
import { Writable } from "node:stream";

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) fail("No terminal to prompt on. Set AUTH_PASSWORD instead.");
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function readPassword(): Promise<string> {
  const { passwordProblem } = await import("../src/server/auth/local/password");
  const fromEnv = process.env.AUTH_PASSWORD;
  const password = fromEnv ?? (await promptHidden("New password: "));
  if (fromEnv === undefined && password !== (await promptHidden("Again: "))) fail("Those passwords don't match.");
  const problem = passwordProblem(password);
  if (problem) fail(problem);
  return password;
}

async function main() {
  const [command, emailArg, extra] = process.argv.slice(2);
  const { authProvider } = await import("../src/server/auth/provider");
  if (authProvider() !== "local") {
    fail("This install signs in through Cognito (the pool's env vars are set). Manage users in the Cognito console, or set AUTH_PROVIDER=local.");
  }
  if (!process.env.DATABASE_URL) fail("Set DATABASE_URL (in .env.local) first.");

  const users = await import("../src/server/auth/local/users");
  const { hashPassword } = await import("../src/server/auth/local/password");
  const needEmail = () => emailArg?.trim() || fail(`Usage: npm run auth -- ${command} you@example.com`);

  switch (command) {
    case "list": {
      const all = await users.listUsers();
      if (!all.length) console.log("No accounts yet. Create one: npm run auth -- create you@example.com");
      for (const u of all) console.log(`${u.id}\t${u.email}${u.name ? `\t${u.name}` : ""}`);
      break;
    }
    case "create": {
      const email = needEmail();
      if (await users.findUserByEmail(email)) fail(`${email} already exists. To change its password: npm run auth -- passwd ${email}`);
      if ((await users.countUsers()) > 0) {
        console.warn("! An account already exists. This app is single-user: every account sees the same data.");
      }
      await users.insertUser({ email, passwordHash: await hashPassword(await readPassword()) });
      console.log(`✓ Created ${users.normalizeEmail(email)}. Sign in at /login.`);
      break;
    }
    case "passwd": {
      const user = (await users.findUserByEmail(needEmail())) ?? fail(`No account for ${emailArg}. See: npm run auth -- list`);
      await users.updatePasswordHash(user.id, await hashPassword(await readPassword()));
      console.log(`✓ Password updated for ${user.email}. Existing sessions and API tokens stop working within the hour.`);
      break;
    }
    case "token": {
      const user = (await users.findUserByEmail(needEmail())) ?? fail(`No account for ${emailArg}. See: npm run auth -- list`);
      const days = extra ? Number(extra) : 90;
      if (!Number.isFinite(days) || days <= 0 || days > 366) fail("Days must be between 1 and 366.");
      const { issueApiToken } = await import("../src/server/auth/local/tokens");
      const token = await issueApiToken(user, days);
      console.error(`Bearer token for ${user.email}, valid ${days} days. Changing the password revokes it.`);
      console.error("Treat it like the password: it grants full access to the app's data.\n");
      console.log(token);
      break;
    }
    default:
      fail("Usage: npm run auth -- <create|passwd|list|token> [email] [days]");
  }
}

main()
  .then(async () => {
    const g = globalThis as unknown as { __billingPool?: { end(): Promise<void> } };
    await g.__billingPool?.end();
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
