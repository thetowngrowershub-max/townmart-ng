#!/usr/bin/env bash
# Nightly logical backup of the TownMart database.
#
#   1. Takes a consistent snapshot, counts the rows of every table in it and
#      dumps exactly that snapshot (pg_dump -Fc), so the restore drill can
#      check the restored copy row for row.
#   2. Encrypts the dump with age to the public key(s) in BACKUP_AGE_RECIPIENTS.
#      Making a backup needs only the public key.
#   3. Keeps it under BACKUP_DIR/daily, and also weekly (Sundays) and monthly
#      (the 1st), Lagos time; prunes to 14 daily, 8 weekly and 12 monthly.
#   4. Copies the same files to a second location with rclone (BACKUP_OFFSITE,
#      e.g. "offsite:townmart-backups"), pruned the same way.
#   5. Records the result in ops_events for /admin/system.
#
# Point-in-time recovery comes from pgBackRest's WAL archive (see DATABASE.md);
# this dump is the independent, portable copy.
#
# Environment:
#   BACKUP_DATABASE_URL    superuser connection (reads every row, bypassing RLS)
#   BACKUP_AGE_RECIPIENTS  one or more age public keys, space separated
#   BACKUP_DIR             local backup directory (default /var/backups/townmart)
#   BACKUP_OFFSITE         rclone destination; empty skips the copy with a warning
#   BACKUP_KEEP_DAILY / _WEEKLY / _MONTHLY   retention counts (14 / 8 / 12)
source "$(dirname "$0")/lib.sh"

need BACKUP_DATABASE_URL BACKUP_AGE_RECIPIENTS
BACKUP_DIR="${BACKUP_DIR:-/var/backups/townmart}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-14}" KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-8}" KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-12}"
URL="$(pg_url "$BACKUP_DATABASE_URL")"

STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="townmart-$STAMP"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; [ -n "${PSQL_PID:-}" ] && kill "$PSQL_PID" 2>/dev/null || true' EXIT

fail() {
  record_event backup false "$STARTED" "" "{\"error\":\"$(json_escape "$1")\"}"
  die "$1"
}

recipients=()
for r in $BACKUP_AGE_RECIPIENTS; do recipients+=(-r "$r"); done

# ── 1. Snapshot, counts, dump ────────────────────────────────────────────────
# A psql session holds the snapshot open while pg_dump reads it.
coproc PSQL { psql "$URL" -X -A -t -q -F $'\t' -v ON_ERROR_STOP=1 2>&1; }
PSQL_PID=$PSQL_PID
echo "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();" >&"${PSQL[1]}"
read -r -t 30 SNAPSHOT <&"${PSQL[0]}" || fail "could not open a snapshot"
[[ "$SNAPSHOT" =~ ^[0-9A-F-]+$ ]] || fail "unexpected snapshot id: $SNAPSHOT"

printf '%s;\n\\echo __END__\n' "$COUNT_SQL" >&"${PSQL[1]}"
: > "$WORK/$NAME.counts.tsv"
while read -r -t 600 line <&"${PSQL[0]}"; do
  [ "$line" = "__END__" ] && break
  printf '%s\n' "$line" >> "$WORK/$NAME.counts.tsv"
done
[ -s "$WORK/$NAME.counts.tsv" ] || fail "could not count rows"

log "dumping $(wc -l < "$WORK/$NAME.counts.tsv") tables from snapshot $SNAPSHOT"
pg_dump "$URL" --format=custom --compress=6 --snapshot="$SNAPSHOT" --file="$WORK/$NAME.dump" || fail "pg_dump failed"
printf 'COMMIT;\n\\q\n' >&"${PSQL[1]}"
wait "$PSQL_PID" 2>/dev/null || true
PSQL_PID=""

# ── 2. Encrypt ───────────────────────────────────────────────────────────────
age "${recipients[@]}" -o "$WORK/$NAME.dump.age" "$WORK/$NAME.dump" || fail "encryption failed"
rm -f "$WORK/$NAME.dump"
( cd "$WORK" && sha256sum "$NAME.dump.age" > "$NAME.dump.age.sha256" )
SIZE="$(stat -c %s "$WORK/$NAME.dump.age")"

# ── 3. Keep locally, with weekly and monthly copies ──────────────────────────
tiers=(daily)
[ "$(TZ=Africa/Lagos date +%u)" = 7 ] && tiers+=(weekly)
[ "$(TZ=Africa/Lagos date +%d)" = 01 ] && tiers+=(monthly)

keep_for() { case "$1" in daily) echo "$KEEP_DAILY" ;; weekly) echo "$KEEP_WEEKLY" ;; monthly) echo "$KEEP_MONTHLY" ;; esac; }

for t in "${tiers[@]}"; do
  mkdir -p "$BACKUP_DIR/$t"
  cp "$WORK/$NAME".* "$BACKUP_DIR/$t/" || fail "could not write to $BACKUP_DIR/$t"
done
# Names sort by time, so everything before the newest N goes.
for t in daily weekly monthly; do
  [ -d "$BACKUP_DIR/$t" ] || continue
  keep="$(keep_for "$t")"
  ls -1 "$BACKUP_DIR/$t" | grep -E '^townmart-[0-9TZ]+\.dump\.age$' | sort -r | tail -n +"$((keep + 1))" | while read -r old; do
    base="${old%.dump.age}"
    rm -f "$BACKUP_DIR/$t/$base".*
    log "pruned $t/$base"
  done || true
done

# ── 4. Second location ───────────────────────────────────────────────────────
OFFSITE="skipped"
if [ -n "${BACKUP_OFFSITE:-}" ]; then
  for t in "${tiers[@]}"; do
    rclone copy "$WORK" "$BACKUP_OFFSITE/$t" --include "$NAME.*" --retries 3 || fail "copy to $BACKUP_OFFSITE/$t failed"
  done
  for t in daily weekly monthly; do
    keep="$(keep_for "$t")"
    rclone lsf "$BACKUP_OFFSITE/$t" --include 'townmart-*.dump.age' 2>/dev/null | sort -r | tail -n +"$((keep + 1))" | while read -r old; do
      base="${old%.dump.age}"
      rclone delete "$BACKUP_OFFSITE/$t" --include "$base.*" || log "WARNING: could not prune $t/$base offsite"
    done || true # a tier that doesn't exist yet has nothing to prune
  done
  OFFSITE="copied"
else
  log "WARNING: BACKUP_OFFSITE is not set; the backup exists in one place only"
fi

record_event backup true "$STARTED" "$SIZE" "{\"file\":\"$NAME.dump.age\",\"tiers\":\"${tiers[*]}\",\"offsite\":\"$OFFSITE\",\"tables\":$(wc -l < "$WORK/$NAME.counts.tsv")}"
log "backup $NAME.dump.age done ($SIZE bytes, ${tiers[*]}, offsite $OFFSITE)"
