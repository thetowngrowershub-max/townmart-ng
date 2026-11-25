# Shared helpers for the backup scripts. Sourced, not run.
# shellcheck shell=bash

set -euo pipefail

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

need() { for v in "$@"; do [ -n "${!v:-}" ] || die "$v is not set"; done; }

# Prisma URLs carry `schema=public`, which libpq rejects; other options
# (sslmode…) are kept.
pg_url() { printf '%s' "$1" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//'; }

# Records a backup or restore drill in ops_events, so /admin/system shows it.
# The backup connection is a superuser, which bypasses RLS like the system scope.
#   record_event backup|restore_test true|false STARTED_ISO SIZE_BYTES|"" '{"json":"details"}'
record_event() {
  local kind="$1" ok="$2" started="$3" size="${4:-}" details="${5:-}"
  [ -n "$details" ] || details='{}'
  psql "$(pg_url "$BACKUP_DATABASE_URL")" -X -q -v ON_ERROR_STOP=1 \
    -v kind="$kind" -v ok="$ok" -v started="$started" -v size="$size" -v details="$details" <<'SQL' || log "WARNING: could not record the $kind in ops_events"
INSERT INTO ops_events (kind, succeeded, started_at, finished_at, size_bytes, details)
VALUES (:'kind'::ops_event_kind, :'ok'::boolean, :'started'::timestamptz, now(), NULLIF(:'size', '')::bigint, :'details'::jsonb);
SQL
}

# The same connection, to another database on the server: pg_url_db URL NAME
pg_url_db() {
  local u q=""
  u="$(pg_url "$1")"
  case "$u" in *\?*) q="?${u#*\?}"; u="${u%%\?*}" ;; esac
  printf '%s/%s%s' "${u%/*}" "$2" "$q"
}

# Row counts of every table in the public schema, as "table<TAB>count" lines.
# shellcheck disable=SC2034 # used by the scripts that source this file
COUNT_SQL="SELECT tablename, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', tablename), false, true, '')))[1]::text
FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename"

json_escape() { local s="${1//\\/\\\\}"; s="${s//\"/\\\"}"; printf '%s' "${s//$'\n'/ }"; }
