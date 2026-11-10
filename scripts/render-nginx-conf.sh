#!/bin/sh
# Renders nginx/template for a domain, substituting the app port read from .env and the
# server's own public IP (SERVER_PUBLIC_IP, optional: without it that allow-line is dropped,
# so host cron calls to /api/sync/run need a device cert or must go via 127.0.0.1).
# Lives in a script rather than inline in the Jenkinsfile so the quoting survives
# Groovy -> shell, and so it can be run by hand to preview the config.
#
# Usage: scripts/render-nginx-conf.sh <domain>   # config on stdout
#        NGINX_TEMPLATE=nginx/template.public scripts/render-nginx-conf.sh <domain>
set -eu

domain="${1:?usage: render-nginx-conf.sh <domain>}"

# nginx/template gates browsers behind a client certificate; nginx/template.public does not.
template="${NGINX_TEMPLATE:-nginx/template}"
[ -f "$template" ] || { echo "template not found: $template" >&2; exit 1; }

# Read PORT directly instead of sourcing .env: DATABASE_URL is quoted and holds
# characters (@, :, /) that break naive `export $(... | xargs)` sourcing.
port=$(sed -n 's/^PORT=//p' .env | head -1 | tr -d "\"' 	
")

[ -n "$port" ] || { echo "PORT not found in .env" >&2; exit 1; }

server_ip=$(sed -n 's/^SERVER_PUBLIC_IP=//p' .env | head -1 | tr -d "\"' 	
")

if [ -n "$server_ip" ]; then
  sed -e "s/__DOMAIN__/$domain/g" -e "s/__PORT__/$port/g" -e "s/__SERVER_IP__/$server_ip/g" "$template"
else
  sed -e "s/__DOMAIN__/$domain/g" -e "s/__PORT__/$port/g" -e "/__SERVER_IP__/d" "$template"
fi
