# --- Stage 1: Build ---
FROM node:22.20.0-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# .env.production is deliberately NOT in .dockerignore: pages are DB-backed, so
# `next build` needs DATABASE_URL to be present while it evaluates routes.
COPY . .
RUN mkdir -p public
RUN npm run build


# --- Stage 2: Runner ---
FROM node:22.20.0-alpine AS runner
WORKDIR /app

RUN addgroup -S nodegroup && adduser -S nodeuser -G nodegroup

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./
# Advisor profile for the MCP connector. config/advisor-profile.json is git-ignored; the
# committed example keeps the directory present so this COPY never fails. In production you
# can instead mount the file and point ADVISOR_PROFILE_PATH at it (see docker-compose.yml).
COPY --from=builder /app/config ./config

# Migration surface: lets the deploy run `drizzle-kit migrate` in a one-off
# container off this same image instead of needing node on the Jenkins agent.
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/src/server/lib/db-url.ts ./src/server/lib/db-url.ts
COPY --from=builder /app/src/server/db/schema.ts ./src/server/db/schema.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
# Hand-written migrations (0005+) aren't in drizzle's journal, so `drizzle-kit migrate`
# skips them; the pipeline's APPLY_SQL stage runs them through this script instead.
COPY --from=builder /app/scripts/apply-sql.ts ./scripts/apply-sql.ts

RUN mkdir -p .next/cache/images && chown -R nodeuser:nodegroup .next

USER nodeuser
EXPOSE ${PORT}

CMD node_modules/.bin/next start -p $PORT
