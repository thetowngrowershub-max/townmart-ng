#!/usr/bin/env bash
# Monthly restore drill. Takes the newest nightly dump (from the second
# location when BACKUP_OFFSITE is set, so that copy is proven too), restores it
# into a scratch database, compares every table's row count with the counts
# taken in the dump's own snapshot, drops the scratch database and records the
# result in ops_events for /admin/system.
#
# Environment: as backup.sh and restore.sh (BACKUP_DATABASE_URL,
# BACKUP_AGE_IDENTITY_FILE, BACKUP_DIR, BACKUP_OFFSITE).
source "$(dirname "$0")/lib.sh"

need BACKUP_DATABASE_URL BACKUP_AGE_IDENTITY_FILE
BACKUP_DIR="${BACKUP_DIR:-/var/backups/townmart}"
URL="$(pg_url "$BACKUP_DATABASE_URL")"
ADMIN="$(pg_url_db "$URL" postgres)"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SCRATCH="townmart_restore_check_$(date -u +%Y%m%d%H%M%S)"
WORK="$(mktemp -d)"

cleanup() {
  psql "$ADMIN" -Xq -c "DROP DATABASE IF EXISTS \"$SCRATCH\" WITH (FORCE)" >/dev/null 2>&1 || log "WARNING: could not drop $SCRATCH"
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() {
  record_event restore_test false "$STARTED" "" "{\"error\":\"$(json_escape "$1")\",\"file\":\"${NAME:-}\"}"
  die "$1"
}

# ── Fetch the newest dump ────────────────────────────────────────────────────
if [ -n "${BACKUP_OFFSITE:-}" ]; then
  NAME="$(rclone lsf "$BACKUP_OFFSITE/daily" --include 'townmart-*.dump.age' | sort -r | head -n1)"
  [ -n "$NAME" ] || fail "no dump found in $BACKUP_OFFSITE/daily"
  rclone copy "$BACKUP_OFFSITE/daily" "$WORK" --include "${NAME%.dump.age}.*" || fail "could not fetch $NAME from $BACKUP_OFFSITE"
  SOURCE="offsite"
else
  NAME="$(ls -1 "$BACKUP_DIR/daily" 2>/dev/null | grep -E '^townmart-[0-9TZ]+\.dump\.age$' | sort -r | head -n1 || true)"
  [ -n "$NAME" ] || fail "no dump found in $BACKUP_DIR/daily"
  cp "$BACKUP_DIR/daily/${NAME%.dump.age}".* "$WORK/"
  SOURCE="local"
fi
BASE="${NAME%.dump.age}"
[ -s "$WORK/$BASE.counts.tsv" ] || fail "$BASE.counts.tsv is missing"
log "restore drill with $NAME ($SOURCE)"

# ── Restore and compare ──────────────────────────────────────────────────────
"$(dirname "$0")/restore.sh" dump "$WORK/$NAME" "$SCRATCH" || fail "restore of $NAME failed"

psql "$(pg_url_db "$URL" "$SCRATCH")" -X -A -t -q -F $'\t' -v ON_ERROR_STOP=1 -c "$COUNT_SQL" > "$WORK/restored.tsv" || fail "could not count rows in the restored copy"
if ! diff -u "$WORK/$BASE.counts.tsv" "$WORK/restored.tsv" > "$WORK/diff.txt"; then
  log "row counts differ:"; cat "$WORK/diff.txt" >&2
  fail "row counts differ from the backup's snapshot: $(grep -c '^[-+][a-z]' "$WORK/diff.txt") lines"
fi

TABLES="$(wc -l < "$WORK/restored.tsv")"
ROWS="$(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$WORK/restored.tsv")"
record_event restore_test true "$STARTED" "$(stat -c %s "$WORK/$NAME")" "{\"file\":\"$NAME\",\"source\":\"$SOURCE\",\"tables\":$TABLES,\"rows\":$ROWS}"
log "restore drill passed: $TABLES tables, $ROWS rows match"
