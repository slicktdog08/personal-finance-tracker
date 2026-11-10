# Authentication

Every page, server action and API route requires a signed-in session. There are two ways to
provide one, and you only need the first.

| | Built-in accounts | AWS Cognito |
|---|---|---|
| Needs | Nothing but the database | An AWS account and a user pool |
| Setup | None: create your account on first visit | ~15 minutes in the AWS console or CLI |
| Password reset | A command on the server | Emailed code |
| Claude via MCP | Bearer token (Claude Code) | OAuth (claude.ai **and** Claude Code) |
| Good for | Most people | You already run Cognito, or want the claude.ai connector |

The app picks **built-in** unless Cognito's settings are present. `AUTH_PROVIDER=local` or
`AUTH_PROVIDER=cognito` forces the choice.

## Built-in accounts

Open the app. With no account yet, the sign-in page is a **Create your account** form. The
account you create is the owner, and the form never appears again — this is a single-user
app, so there is no sign-up page to leave open.

> Create your account right after the first start. Until you do, anyone who can reach the
> URL could claim it. On a public server, either do it immediately or create the account
> from the command line before exposing the port.

### Managing the account from the command line

```bash
npm run auth -- create you@example.com   # prompts for a password
npm run auth -- passwd you@example.com   # new password; signs out every session
npm run auth -- list
npm run auth -- token  you@example.com   # bearer token for Claude Code (see claude-mcp.md)
```

In Docker, prefix with `docker compose -f compose.selfhost.yml exec app`. For scripted
setups, pass the password as `AUTH_PASSWORD` instead of typing it.

### How it works

- **Passwords** are hashed with scrypt (Node's built-in crypto, a random salt per hash) and
  stored in the `users` table. The plain password is never stored or logged.
- **Sessions** are three `httpOnly`, `SameSite=Lax` cookies holding tokens the app signs
  itself (HMAC-SHA256): a one-hour access token, an id token for display, and a 30-day
  refresh token. JavaScript in the page can't read them.
- **The signing key** is `AUTH_SECRET` if you set it. Otherwise one is generated on first
  use and kept in the database, so there is nothing to configure. Changing it signs everyone out.
- **Changing the password** invalidates refresh tokens and API tokens immediately; a browser
  session already open ends within the hour.
- **Guessing is throttled**: eight wrong passwords for an address locks it for ten minutes.
- Cookies are marked `Secure` in production unless `APP_URL` is an `http://` address (the
  local Docker quick start) or `AUTH_COOKIE_SECURE=0`.

There is no email, so there is no "forgot password" email: reset it with `passwd` above.
No MFA either. If you need MFA or emailed resets, use Cognito.

## AWS Cognito

Set the three pool values and the app switches to Cognito on its own:

```bash
NEXT_PUBLIC_AWS_REGION="us-east-1"
NEXT_PUBLIC_COGNITO_USER_POOL_ID="us-east-1_XXXXXXXXX"
NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID="XXXXXXXXXXXXXXXXXXXXXXXXXX"
```

(With the published Docker image, the un-prefixed names `AWS_REGION`, `COGNITO_USER_POOL_ID`
and `COGNITO_USER_POOL_CLIENT_ID` work too, and are read when the container starts.)

1. Create a user pool and a **public app client** (no client secret).
2. Enable password auth on the client. The app signs in from the server, so it can't use
   the default SRP-only flow:
   ```bash
   aws cognito-idp update-user-pool-client \
     --user-pool-id "$NEXT_PUBLIC_COGNITO_USER_POOL_ID" \
     --client-id "$NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID" \
     --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH
   ```
   `--explicit-auth-flows` *replaces* the whole list. Keep `ALLOW_REFRESH_TOKEN_AUTH` in it,
   or sessions stop renewing after an hour.
3. Create your user (there is no self-signup):
   ```bash
   aws cognito-idp admin-create-user \
     --user-pool-id "$NEXT_PUBLIC_COGNITO_USER_POOL_ID" \
     --username you@example.com \
     --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true \
     --temporary-password 'SomeTempPass1!'
   ```
   Your first sign-in asks you to choose a new password.

If the app client was created *with* a secret, set `COGNITO_CLIENT_SECRET` too.

### Switching between the two

The two are independent: built-in accounts live in the `users` table, Cognito users live in
AWS, and your financial data belongs to neither (the app is single-user, so whoever signs in
sees the same ledger). To move from Cognito to built-in, remove the Cognito variables (or
set `AUTH_PROVIDER=local`) and create an account. To move the other way, set them.

## Under both

`src/proxy.ts` gates every request on an allowlist, so a page added later is protected by
default. Every server action and query then checks again with `requireSession()`, and the
token's signature is verified on each request rather than trusted because a cookie exists.
