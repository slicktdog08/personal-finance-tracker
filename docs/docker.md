# Running with Docker

The image holds the whole app: the web server, the schema, the migration runner and the
command-line tools. It carries no configuration and no credentials — everything is supplied
when it runs — so the same image works for anyone.

```
ghcr.io/slicktdog08/personal-finance-tracker:latest
```

## One machine, everything included

[`compose.selfhost.yml`](../compose.selfhost.yml) runs MySQL and the app together.

```bash
docker compose -f compose.selfhost.yml up -d
docker compose -f compose.selfhost.yml logs -f app   # watch the first boot
```

On start the app container:

1. waits for MySQL,
2. creates the schema and default lookups if the database is empty,
3. applies any migrations it hasn't applied yet,
4. starts the server on port 3000.

Every step is safe to repeat, so restarts and upgrades need nothing special.

### Settings

Put these in a `.env` file next to the compose file. All are optional for a local try-out;
**change the passwords before the machine is reachable by anyone else.**

| Variable | Default | Purpose |
|---|---|---|
| `DB_PASSWORD` | `finance-local-only` | Password of the app's MySQL user |
| `DB_ROOT_PASSWORD` | `root-local-only` | MySQL root password |
| `APP_PORT` | `3000` | Port on the host |
| `APP_URL` | `http://localhost:3000` | Your public origin. Set it to the `https://` address once you add a reverse proxy; session cookies become `Secure` automatically |
| `SYNC_TOKEN_ENCRYPTION_KEY` | *(unset)* | `openssl rand -hex 32`. Only needed for [bank sync](importing.md#3-bank-sync) |
| `PFT_IMAGE` | `…:latest` | Pin a version, e.g. `ghcr.io/slicktdog08/personal-finance-tracker:1.2.0` |
| `DEMO_MODE` | `0` | `1` = sample data and automatic sign-in. **Wipes the database on every start** |

The app listens on `127.0.0.1` only. To reach it from other devices on your network, change
the port mapping in the compose file to `"3000:3000"` and set `APP_URL` to the address you
type in the browser (for example `http://192.168.1.20:3000`).

### Everyday commands

```bash
# upgrade
docker compose -f compose.selfhost.yml pull && docker compose -f compose.selfhost.yml up -d

# reset a forgotten password
docker compose -f compose.selfhost.yml exec app npm run auth -- passwd you@example.com

# back up / restore
docker compose -f compose.selfhost.yml exec db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" finance' > backup.sql
docker compose -f compose.selfhost.yml exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" finance' < backup.sql

# stop (keeps your data) / stop and delete everything
docker compose -f compose.selfhost.yml down
docker compose -f compose.selfhost.yml down -v
```

### Build it yourself

No published image for your platform, or you changed the code:

```bash
git clone https://github.com/slicktdog08/personal-finance-tracker && cd personal-finance-tracker
docker compose -f compose.selfhost.yml up -d --build
```

## Just the app container

Already have MySQL? Run only the app and point it at your database:

```bash
docker run -d --name finance -p 127.0.0.1:3000:3000 \
  -e DATABASE_URL='mysql://user:password@db-host:3306/finance' \
  -e APP_URL='http://localhost:3000' \
  ghcr.io/slicktdog08/personal-finance-tracker:latest
```

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Required. The password may contain `@`; don't percent-encode it |
| `DATABASE_MIGRATION_URL` | A user with CREATE/ALTER rights, if the runtime user has none |
| `AUTO_MIGRATE=0` | Skip schema creation and migrations at start (when your deploy runs them itself) |
| `PORT` | Port inside the container (default 3000) |

Everything in [configuration.md](configuration.md) can be passed the same way.

## Going public

Running it on a server other people can reach? Put a reverse proxy with TLS in front, set
`APP_URL` to the `https://` origin, and use real passwords. [hosting.md](hosting.md) has an
nginx + Let's Encrypt walkthrough.

## How the image gets published

[`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml) builds for
amd64 and arm64 and pushes to GitHub Container Registry: `:latest` on every push to `main`,
and `:X.Y.Z` for a `vX.Y.Z` tag. Forks publish to their own namespace with no changes. After
the first publish, set the package's visibility to **Public** on GitHub (Packages → the
package → Package settings) so `docker pull` works without logging in.
