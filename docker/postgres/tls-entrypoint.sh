#!/usr/bin/env bash
# Makes sure Postgres has a TLS certificate before the official entrypoint runs.
# Mount your own at /var/lib/postgresql/tls (server.crt, server.key); otherwise
# a self-signed one is created once and kept in that volume. Clients on the
# private network use sslmode=require (encrypted); use verify-full with a
# certificate from your own CA if the database is reached across networks.
set -euo pipefail
TLS=/var/lib/postgresql/tls
mkdir -p "$TLS"
if [ ! -s "$TLS/server.key" ] || [ ! -s "$TLS/server.crt" ]; then
  openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -subj "/CN=${POSTGRES_TLS_CN:-postgres}" \
    -keyout "$TLS/server.key" -out "$TLS/server.crt" 2>/dev/null
  echo "tls-entrypoint: created a self-signed certificate in $TLS"
fi
chown -R postgres:postgres "$TLS"
chmod 600 "$TLS/server.key"
exec docker-entrypoint.sh "$@"
