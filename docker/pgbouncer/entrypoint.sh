#!/usr/bin/env bash
# Writes PgBouncer's user list from the environment, makes a TLS certificate if
# none is mounted, and starts PgBouncer. Only the app and read-only roles may
# connect through the pooler.
set -euo pipefail
: "${TOWNMART_APP_PASSWORD:?}" "${TOWNMART_READONLY_PASSWORD:?}"
quote() { printf '"%s"' "${1//\"/\"\"}"; }
{
  printf '%s %s\n' "$(quote townmart_app)" "$(quote "$TOWNMART_APP_PASSWORD")"
  printf '%s %s\n' "$(quote townmart_readonly)" "$(quote "$TOWNMART_READONLY_PASSWORD")"
} > /etc/pgbouncer/userlist.txt
chmod 600 /etc/pgbouncer/userlist.txt
TLS=/etc/pgbouncer/tls
if [ ! -s "$TLS/server.key" ]; then
  openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -subj "/CN=${PGBOUNCER_TLS_CN:-pgbouncer}" \
    -keyout "$TLS/server.key" -out "$TLS/server.crt" 2>/dev/null
fi
exec pgbouncer /etc/pgbouncer/pgbouncer.ini
