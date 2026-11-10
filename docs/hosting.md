# Hosting

Running it on your own computer needs none of this: see [docker.md](docker.md). This page is
for putting it on a server with a domain.

The app needs three things in production:

- **A long-running Node process.** The sync scheduler runs in-process, statement uploads can
  reach 25 MB, and PDF parsing can take a while.
- **MySQL.**
- **HTTPS on a domain.** Session cookies are `Secure` in production, and claude.ai only connects over HTTPS.

Serverless platforms like Vercel can render the pages, but they cut off the scheduler and
reject large uploads, so a VPS or container host is the better fit.

### Option A: VPS with Docker and nginx (what this repo ships)

Everything is in the repo. The app runs in a container bound to `127.0.0.1:${PORT}`, and
nginx proxies to it with TLS from Let's Encrypt.

```bash
# on the server
git clone https://github.com/slicktdog08/personal-finance-tracker && cd personal-finance-tracker
cp .env.example .env.production        # fill in real values (PORT, DATABASE_URL, APP_URL)
cp .env.production .env                # docker compose reads PORT from .env

docker compose build
docker compose up -d                   # creates the schema on first start, migrates on every start

sh scripts/render-nginx-conf.sh finance.example.com | sudo tee /etc/nginx/sites-available/finance.example.com
sudo ln -s /etc/nginx/sites-available/finance.example.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d finance.example.com
```

The container creates the schema in an empty database and applies new migrations each time
it starts (`AUTO_MIGRATE=0` turns that off). No env file is copied into the image:
`.env.production` is read when the container runs, so changing a setting needs a restart,
not a rebuild. Then open the site and create your account
([authentication.md](authentication.md)).

> **The shipped nginx template is locked down on purpose.** `nginx/template` only lets a
> browser in if it presents a client certificate signed by your own CA
> (`/etc/nginx/client-ca/ca.crt`), on top of the app's sign-in. That suits one person's
> finances, but you have to issue yourself a certificate first. For an ordinary
> password-only site (or the public demo), render the open variant instead:
> `NGINX_TEMPLATE=nginx/template.public sh scripts/render-nginx-conf.sh finance.example.com`.

| File | Role |
|---|---|
| `Dockerfile` | Two-stage build. The runtime image runs as a non-root user and holds no configuration |
| `docker-compose.yml` | The app alone, against an external MySQL, `restart: always`, loopback only |
| `compose.selfhost.yml` | The app plus its own MySQL ([docker.md](docker.md)) |
| `nginx/template`, `nginx/template.public` + `scripts/render-nginx-conf.sh` | Site config with long timeouts and large-body limits for imports; with and without the client-certificate gate |
| `JenkinsFile` | Optional CI/CD (Option B) |

### Option B: Jenkins pipeline (push to deploy)

`JenkinsFile` automates Option A on every build. It runs: clean workspace → restore secrets
→ nginx + certbot over SSH → `docker compose build` → apply pending SQL migrations →
swap the container → prune old images.

One-time setup in Jenkins:
1. Create a **Secret file** credential `personal-billing-env-production` containing `.env.production`.
   Put `APP_URL`, `CERTBOT_EMAIL` and `SERVER_PUBLIC_IP` in it too: the pipeline reads the
   domain, certbot address and nginx IP from there, so nothing personal sits in this repo.
2. Create an **SSH credential** `vps-deploy-key` that can log in to the host as `deployer`.
3. Point a Pipeline job at this repo (script path `JenkinsFile`). The `DOMAIN` and
   `CERTBOT_EMAIL` parameters can stay blank.
4. Create the DNS A record **before** the first run, because certbot validates over HTTP.

`APPLY_SQL` (on by default) applies each new `drizzle/*.sql` exactly once and stops the
deploy if one fails. `RUN_MIGRATIONS` runs `drizzle-kit migrate` for the early journaled
migrations, which a fresh install doesn't need.

### Option C: A container platform (Railway, Render, Fly.io…)

Deploy the `Dockerfile` (or the published image) with a managed MySQL and set the environment
variables in the platform's dashboard. The container builds its own schema on first start.
The advisor profile lives in the database, so there is nothing to mount.

### Updating

Pull, rebuild and redeploy. The new container applies pending schema changes when it starts.
To apply them as a separate step first (the Jenkins pipeline does, so a failed migration
stops the deploy before the old container is replaced), run
`npx tsx scripts/apply-sql.ts --pending`. It records what it has applied and is safe to re-run.

## The public demo

Deploying a demo instance is its own short recipe: [demo.md](demo.md).
