# Connecting Claude

The app runs its own [MCP](https://modelcontextprotocol.io) server at `/api/mcp`. Connect
Claude to it and you can talk about your actual numbers: "Can I afford this?", "How did this
month go?", "What's my fastest path out of debt?"

- **15 read tools:** snapshot, month summaries, spending and balance trends, debts and payoff
  projections, cash projection, budget, goals and transaction search.
- **9 write tools that only add or edit, never delete.** Claude has to say exactly what will
  change and wait for your OK.
- **Prompts:** `monthly_review`, `can_i_afford`, `debt_payoff_plan`, `budget_check_in`.
- **An advisor profile** stored in your database gives Claude standing context: your
  situation, your plan, what money is off-limits.

How Claude signs in depends on [which sign-in you use](authentication.md):

| | Claude Code | claude.ai connector |
|---|---|---|
| Built-in accounts | ✅ bearer token | ❌ needs OAuth, which only Cognito provides |
| Cognito | ✅ OAuth | ✅ OAuth |

## With built-in accounts (Claude Code)

Mint a token on the server and hand it to Claude Code:

```bash
npm run auth -- token you@example.com 90        # prints a token valid for 90 days
claude mcp add --transport http finance https://finance.example.com/api/mcp \
  --header "Authorization: Bearer <the token>"
```

The token is as powerful as your password, so keep it out of files you commit. Changing your
password revokes it.

## With Cognito (claude.ai and Claude Code)

Claude signs in with OAuth 2.0 + PKCE against **your Cognito pool**. When an unauthenticated request hits `/api/mcp`, the app returns `401` with
a pointer to `/.well-known/oauth-protected-resource`. That document names Cognito as the
authorization server. After you sign in on Cognito's hosted page, every call carries a bearer
token that's verified like a web session.

**One-time Cognito setup**
1. **Give the pool a domain** (User pools → Domain; a Cognito prefix domain is fine). Without one,
   the OAuth endpoints don't exist.
2. **Create a second app client** for Claude:
   - Confidential, *with* a client secret.
   - Managed login enabled.
   - Callback URL `https://claude.ai/api/mcp/auth_callback`.
   - Grant type: Authorization code. Scope: `openid`. Auth flows: `ALLOW_REFRESH_TOKEN_AUTH` only.
3. Set `COGNITO_MCP_CLIENT_ID` and `APP_URL`, then redeploy.

**In claude.ai**, go to Settings → Connectors → *Add custom connector* and enter:
- URL: `https://finance.example.com/api/mcp`
- Advanced: the MCP client's ID and secret

For **Claude Code**: `claude mcp add --transport http finance https://finance.example.com/api/mcp`.
Add `http://localhost/callback` and `http://127.0.0.1/callback` to the client's callback URLs.

**Checking it works**
- `curl -i https://…/.well-known/oauth-protected-resource` should return the metadata document.
- `curl -i -X POST https://…/api/mcp` should return `401` with a `resource_metadata` header.
- With the `pb_at` cookie value (copied from your browser's dev tools after signing in) as
  `$TOKEN`, run:
  ```bash
  curl -s -X POST https://…/api/mcp -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```

## Insights and chat inside the app

`/insights` and `/advisor` put the advisor in the app itself. The buttons fire a
[Claude Code routine](../planning/features/ai-advisor.md) instead of calling the Anthropic
API, so the work runs on your Claude plan rather than metered API credit. The routine reads
your data and writes its answer back through the same MCP connector.

Create the routine on claude.ai with this app's connector and an API trigger, then set
`CLAUDE_ADVISOR_ROUTINE_ID` and `CLAUDE_ADVISOR_ROUTINE_TOKEN`. Leave them unset and the
buttons are hidden.

## The advisor profile

```bash
cp config/advisor-profile.example.json config/advisor-profile.json   # describe your situation
npx tsx scripts/advisor-profile.ts import                             # store it in the database
```

After that the file can go; the database copy is what the app reads. Or just ask Claude to
save it — it has an `update_advisor_profile` tool. `/setup` in Claude Code will interview
you and write it.
