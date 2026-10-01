#!/bin/sh
# Renders nginx/template for a domain, substituting the app port read from .env.
# Lives in a script rather than inline in the Jenkinsfile so the quoting survives
# Groovy -> shell, and so it can be run by hand to preview the config.
#
# Usage: scripts/render-nginx-conf.sh <domain>   # config on stdout
set -eu

domain="${1:?usage: render-nginx-conf.sh <domain>}"

# Read PORT directly instead of sourcing .env: DATABASE_URL is quoted and holds
# characters (@, :, /) that break naive `export $(... | xargs)` sourcing.
port=$(sed -n 's/^PORT=//p' .env | head -1 | tr -d "\"' 	
")

[ -n "$port" ] || { echo "PORT not found in .env" >&2; exit 1; }

sed -e "s/__DOMAIN__/$domain/g" -e "s/__PORT__/$port/g" nginx/template
