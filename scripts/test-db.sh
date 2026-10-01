#!/usr/bin/env bash
# Brings the throwaway test database up (or down, or resets it).
#
#   ./scripts/test-db.sh up      start it and wait until it answers
#   ./scripts/test-db.sh down    stop and discard it
#   ./scripts/test-db.sh reset   down + up, i.e. a pristine schema
#
# The data directory is a tmpfs, so "up" on a stopped container always re-runs
# tests/db/schema.sql from scratch — there is no such thing as a stale test database.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.test.yml"
SERVICE=mysql-test

case "${1:-up}" in
  down)
    $COMPOSE down -v
    ;;
  reset)
    $COMPOSE down -v
    exec "$0" up
    ;;
  up)
    if [ ! -f .env.test ]; then
      echo "→ creating .env.test from .env.test.example"
      cp .env.test.example .env.test
    fi
    $COMPOSE up -d
    # The amd64 image is emulated, so first boot takes a while. Poll the healthcheck
    # rather than sleeping a guessed number of seconds.
    printf "waiting for %s" "$SERVICE"
    for _ in $(seq 1 120); do
      state=$($COMPOSE ps --format json 2>/dev/null | grep -o '"Health":"[a-z]*"' | head -1 | cut -d'"' -f4 || true)
      if [ "$state" = "healthy" ]; then
        echo " ✓"
        echo "Test database ready on 127.0.0.1:3307 (schema from tests/db/schema.sql)."
        exit 0
      fi
      printf "."
      sleep 2
    done
    echo " ✗"
    echo "Timed out. Logs:"
    $COMPOSE logs --tail=40 "$SERVICE"
    exit 1
    ;;
  *)
    echo "usage: $0 {up|down|reset}" >&2
    exit 2
    ;;
esac
