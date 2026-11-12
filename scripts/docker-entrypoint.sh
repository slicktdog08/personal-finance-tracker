#!/bin/sh
# Container start-up: make the database usable, then run the app.
#
#   1. wait for MySQL (compose starts both at once, and MySQL's first boot is slow)
#   2. empty database  -> create the schema and default lookups   (scripts/init-db.ts)
#   3. always          -> apply migrations not yet recorded        (scripts/apply-sql.ts --pending)
#   4. DEMO_MODE=1     -> replace everything with fresh sample data (scripts/seed-demo.ts --reset --force)
#
# Every step is idempotent, so restarting the container is always safe. Set AUTO_MIGRATE=0
# to skip 1-3 when a deploy pipeline runs migrations itself. Schema changes need a user with
# CREATE/ALTER rights: DATABASE_MIGRATION_URL if set, otherwise DATABASE_URL.
set -e

TSX=node_modules/.bin/tsx

if [ -z "$DATABASE_URL" ]; then
  echo "✗ DATABASE_URL is not set. See .env.example." >&2
  exit 1
fi

if [ "${AUTO_MIGRATE:-1}" != "0" ]; then
  $TSX scripts/init-db.ts --wait --if-empty
  $TSX scripts/apply-sql.ts --pending
fi

if [ "$DEMO_MODE" = "1" ]; then
  # --force: a demo volume seeded before the demo_seeded marker existed must still reset.
  # seed-demo.ts still refuses when DATABASE_MIGRATION_URL names a different database, and the
  # periodic reset in the app never forces.
  $TSX scripts/seed-demo.ts --reset --force
fi

exec node_modules/.bin/next start -p "${PORT:-3000}"
