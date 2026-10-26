#!/usr/bin/env bash
# Creates TownMart's database roles and database on an existing Postgres server
# (CI, bare-metal, or a managed VM). Docker Compose does this automatically.
# Usage: pnpm db:bootstrap   (reads .env if present)
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ -f .env ]]; then set -a; source .env; set +a; fi

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${TOWNMART_MIGRATOR_PASSWORD:?}" "${TOWNMART_APP_PASSWORD:?}" "${TOWNMART_READONLY_PASSWORD:?}"

PGPASSWORD="${POSTGRES_PASSWORD:-}" psql -v ON_ERROR_STOP=1 \
  --host "${POSTGRES_HOST:-localhost}" --port "${POSTGRES_PORT:-5432}" \
  --username "$POSTGRES_USER" --dbname postgres \
  -v db_name="${POSTGRES_DB:-townmart}" \
  -v migrator_password="$TOWNMART_MIGRATOR_PASSWORD" \
  -v app_password="$TOWNMART_APP_PASSWORD" \
  -v readonly_password="$TOWNMART_READONLY_PASSWORD" \
  -f sql/bootstrap/roles.sql
echo "TownMart roles and database are ready."
