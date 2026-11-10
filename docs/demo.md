# The demo

A copy of the app filled with made-up money, for looking around without installing anything
or connecting a bank.

**Sign in with the account already filled in on the sign-in page.** Every name, merchant and
number is generated. Change whatever you like: it all resets on a timer.

## What demo mode changes

`DEMO_MODE=1` turns an install into the demo:

| | Normal | Demo |
|---|---|---|
| Data | Yours | About six months of fictional history, regenerated relative to today |
| Sign-in | Your account | A shared demo account, filled in for you (always built-in auth) |
| Bank sync | SimpleFIN / Plaid | A pretend "Demo Bank" that is already connected; real linking is switched off |
| AI advisor buttons | Fire your Claude routine | Explain that they're off in the demo |
| Database | Left alone | **Wiped and reseeded at every start and every `DEMO_RESET_MINUTES`** |

Because of the last row, never set `DEMO_MODE=1` on a database with real data in it.

## Run one yourself

```bash
docker compose -p pft-demo -f docker-compose.demo.yml up -d --build
# http://localhost:9011
```

That file brings its own MySQL and needs no secrets, so it can't touch anything real. For a
quick look on an existing checkout instead: `npm run seed:demo` into a scratch database and
start the app with `DEMO_MODE=1`.

## Put it on a domain

On a server that already runs nginx and Docker:

1. Point a DNS A record at the server.
2. Start it, telling it its public address:
   ```bash
   DEMO_URL=https://demo.example.com DEMO_PORT=9011 \
     docker compose -p pft-demo -f docker-compose.demo.yml up -d --build
   ```
3. Give nginx the **open** site config (the default template demands a client certificate,
   which a public demo must not) and a certificate:
   ```bash
   echo "PORT=9011" > .env
   NGINX_TEMPLATE=nginx/template.public sh scripts/render-nginx-conf.sh demo.example.com \
     | sudo tee /etc/nginx/sites-available/demo.example.com
   sudo ln -s /etc/nginx/sites-available/demo.example.com /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d demo.example.com
   ```

With Jenkins, point a Pipeline job at `JenkinsFile.demo` and fill in `DOMAIN`,
`CERTBOT_EMAIL` and `DEMO_PORT`; it does steps 2 and 3 on every build. It needs the same
`vps-deploy-key` SSH credential as the main pipeline and no secret file.

## Settings

| Variable | Default | Purpose |
|---|---|---|
| `DEMO_URL` | `http://localhost:9011` | Public origin (compose passes it to the app as `APP_URL`) |
| `DEMO_PORT` | `9011` | Loopback port nginx proxies to |
| `DEMO_RESET_MINUTES` | `60` | Reset interval; `0` resets only at start |
| `DEMO_EMAIL`, `DEMO_PASSWORD` | `demo@example.com` / `demo-password` | The shared account shown on the sign-in page |

## Worth knowing before you publish one

- Visitors share one account and one dataset, so one person's edits are visible to the next
  until the reset. Text they type (notes, names) is included in that.
- Uploads work (that's the point of trying the import), capped at the app's usual 25 MB.
- The demo is rate-limited only by nginx and the server it runs on.
