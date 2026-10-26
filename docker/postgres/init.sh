#!/usr/bin/env bash
# Runs once, on the first start of an empty Postgres data volume.
set -euo pipefail
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname postgres \
  -v db_name="${TOWNMART_DB:-townmart}" \
  -v migrator_password="$TOWNMART_MIGRATOR_PASSWORD" \
  -v app_password="$TOWNMART_APP_PASSWORD" \
  -v readonly_password="$TOWNMART_READONLY_PASSWORD" \
  -f /sql/bootstrap/roles.sql
