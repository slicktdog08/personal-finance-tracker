# --- Stage 1: Build ---
FROM node:22.20.0-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN mkdir -p public

# The image is configured when it RUNS, not when it is built: no .env file is copied in
# (.dockerignore) and nothing here is a secret, so the same image can be published and run
# by anyone. `next build` only needs DATABASE_URL to be *present* — importing the database
# module checks for it — and never connects, so a placeholder is enough.
RUN DATABASE_URL="mysql://build:build@127.0.0.1:3306/build" npm run build


# --- Stage 2: Runner ---
FROM node:22.20.0-alpine AS runner
WORKDIR /app

RUN addgroup -S nodegroup && adduser -S nodeuser -G nodegroup

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./
# Optional fallback advisor profile. The real one lives in the database (app_settings), so
# normally only the committed example is here; the directory exists so this COPY never fails.
COPY --from=builder /app/config ./config

# Setup and maintenance surface, run with tsx off this same image so no host needs Node:
# first-boot schema creation and migrations (scripts/docker-entrypoint.sh), the account CLI
# (`npm run auth`), demo seeding, and the bank-sync CLI. They import from src/, and the
# fresh-install schema lives in tests/db/.
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/tests/db ./tests/db
COPY --from=builder /app/tests/stubs ./tests/stubs
COPY --from=builder /app/tests/stubs.cjs ./tests/stubs.cjs

RUN mkdir -p .next/cache/images && chown -R nodeuser:nodegroup .next && chmod +x scripts/docker-entrypoint.sh

USER nodeuser
EXPOSE 3000

# Creates the schema in an empty database, applies pending migrations, then starts the app.
# AUTO_MIGRATE=0 skips straight to starting (for deploys that migrate in their own step).
ENTRYPOINT ["scripts/docker-entrypoint.sh"]
