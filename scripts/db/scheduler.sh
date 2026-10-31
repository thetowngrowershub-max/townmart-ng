#!/usr/bin/env bash
# Backup scheduler for the "backup" service in docker-compose.prod.yml. Runs as
# the postgres user next to the database, Lagos time:
#   01:00 daily     pgBackRest backup (full on Sundays, differential otherwise)
#   01:30 daily     encrypted logical dump (backup.sh)
#   04:00 on the 1st  restore drill (verify-restore.sh)
# Every run is recorded in ops_events and shown on /admin/system. A failed job
# is retried at its next slot; the scheduler itself keeps running.
source "$(dirname "$0")/lib.sh"
set +e
DIR="$(cd "$(dirname "$0")" && pwd)"
STANZA="${PGBACKREST_STANZA:-townmart}"
export TZ=Africa/Lagos

repos() { echo 1; [ -n "${PGBACKREST_REPO2_TYPE:-}" ] && echo 2; }

physical_backup() {
  local type=diff started size=""
  [ "$(date +%u)" = 7 ] && type=full
  for repo in $(repos); do
    started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    if pgbackrest --stanza="$STANZA" --repo="$repo" --type="$type" backup; then
      size="$(pgbackrest --stanza="$STANZA" --repo="$repo" --output=json info 2>/dev/null | jq -r '.[0].backup[-1].info.repository.delta // empty')"
      record_event backup true "$started" "$size" "{\"tool\":\"pgbackrest\",\"type\":\"$type\",\"repo\":$repo}"
    else
      record_event backup false "$started" "" "{\"tool\":\"pgbackrest\",\"type\":\"$type\",\"repo\":$repo,\"error\":\"pgbackrest backup failed; see the backup service log\"}"
    fi
  done
}

# Idempotent: creates the stanza on first start, then checks archiving works.
until pgbackrest --stanza="$STANZA" stanza-create; do log "waiting for Postgres to accept pgBackRest…"; sleep 15; done
pgbackrest --stanza="$STANZA" check || log "WARNING: pgBackRest check failed; WAL archiving may be broken"
[ -n "${BACKUP_RUN_ON_START:-}" ] && { physical_backup; "$DIR/backup.sh"; }

declare -A done_on
run_at() { # run_at HH:MM name command… — once per day at that minute
  local at="$1" name="$2"; shift 2
  if [ "$(date +%H:%M)" = "$at" ] && [ "${done_on[$name]:-}" != "$(date +%F)" ]; then
    done_on[$name]="$(date +%F)"
    log "starting $name"
    "$@" || log "$name failed"
  fi
}

log "backup scheduler running (Lagos time)"
while true; do
  run_at 01:00 physical physical_backup
  run_at 01:30 dump "$DIR/backup.sh"
  [ "$(date +%d)" = 01 ] && run_at 04:00 drill "$DIR/verify-restore.sh"
  sleep 20
done
