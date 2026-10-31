#!/usr/bin/env bash
# Restores TownMart's database. Two ways:
#
#   restore.sh dump <file.dump.age> <new-database-name>
#       Decrypts a nightly dump and restores it into a NEW database on the
#       server in BACKUP_DATABASE_URL. It never touches an existing database:
#       to put it live, stop the app and worker, rename the databases and start
#       them again (DATABASE.md, "Restore runbook").
#
#   restore.sh pitr <target-time>
#       Point-in-time recovery from pgBackRest: rebuilds the stopped server's
#       data directory as it was at <target-time> (e.g. "2026-11-02 14:30:00+01")
#       and promotes it when it gets there. Run on the database host with
#       Postgres stopped.
#
# Environment:
#   BACKUP_DATABASE_URL        superuser connection (dump mode)
#   BACKUP_AGE_IDENTITY_FILE   age private key that decrypts the dumps (dump mode)
#   PGBACKREST_STANZA          pgBackRest stanza (default townmart; pitr mode)
#   PGDATA                     data directory of the stopped server (pitr mode)
source "$(dirname "$0")/lib.sh"

usage() { sed -n '2,17p' "$0" >&2; exit 2; }

restore_dump() {
  local file="$1" target="$2"
  need BACKUP_DATABASE_URL BACKUP_AGE_IDENTITY_FILE
  [ -f "$file" ] || die "no such file: $file"
  [[ "$target" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die "database name must be lowercase letters, digits and underscores"
  if [ -f "$file.sha256" ]; then
    ( cd "$(dirname "$file")" && sha256sum --quiet -c "$(basename "$file").sha256" ) || die "checksum does not match: $file"
  fi

  local url admin
  url="$(pg_url "$BACKUP_DATABASE_URL")"
  admin="$(pg_url_db "$url" postgres)"
  if [ "$(psql "$admin" -XAtqc "SELECT 1 FROM pg_database WHERE datname = '$target'")" = 1 ]; then
    die "database $target already exists; choose a new name"
  fi

  local work
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN
  age -d -i "$BACKUP_AGE_IDENTITY_FILE" -o "$work/db.dump" "$file" || die "could not decrypt $file"

  log "restoring $(basename "$file") into $target"
  # Same database-level rights as sql/bootstrap/roles.sql.
  psql "$admin" -Xq -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE \"$target\" OWNER townmart_migrator" \
    -c "REVOKE ALL ON DATABASE \"$target\" FROM PUBLIC" \
    -c "GRANT CONNECT, TEMPORARY ON DATABASE \"$target\" TO townmart_app, townmart_readonly"
  # Extensions and objects come from the dump; owners and grants are kept, so
  # the townmart_* roles must exist on this server (scripts/db/bootstrap.sh).
  pg_restore --dbname="$(pg_url_db "$url" "$target")" --exit-on-error --jobs=4 "$work/db.dump" || die "pg_restore failed; $target is incomplete, drop it before retrying"
  log "restored into $target"
}

restore_pitr() {
  local target_time="$1"
  need PGDATA
  local stanza="${PGBACKREST_STANZA:-townmart}"
  [ -f "$PGDATA/postmaster.pid" ] && die "Postgres is running on $PGDATA; stop it first"
  log "point-in-time restore of stanza $stanza to $target_time into $PGDATA"
  # --delta reuses unchanged files; recovery stops at the target and promotes.
  pgbackrest --stanza="$stanza" --pg1-path="$PGDATA" --delta \
    --type=time --target="$target_time" --target-action=promote restore
  log "restore done; start Postgres and check the logs for 'recovery stopping before' then 'database system is ready'"
}

case "${1:-}" in
  dump) [ $# -eq 3 ] || usage; restore_dump "$2" "$3" ;;
  pitr) [ $# -eq 2 ] || usage; restore_pitr "$2" ;;
  *) usage ;;
esac
