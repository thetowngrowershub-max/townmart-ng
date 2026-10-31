# syntax=docker/dockerfile:1.7
# Production Postgres 16 for TownMart: TLS on, pg_stat_statements loaded,
# WAL archived by pgBackRest for point-in-time recovery. The same image runs
# the backup scheduler (docker-compose.prod.yml, service "backup"), so pg_dump,
# pgBackRest and the restore tools always match the server's version.
FROM postgres:16-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest age rclone jq openssl ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && install -d -o postgres -g postgres -m 750 /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest /var/backups/townmart

COPY docker/postgres/postgresql.prod.conf /etc/postgresql/postgresql.conf
COPY docker/postgres/pg_hba.prod.conf /etc/postgresql/pg_hba.conf
COPY docker/postgres/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY docker/postgres/tls-entrypoint.sh /usr/local/bin/tls-entrypoint.sh
COPY docker/postgres/init.sh /docker-entrypoint-initdb.d/10-townmart.sh
COPY sql/bootstrap /sql/bootstrap
COPY scripts/db /opt/townmart/scripts/db

ENTRYPOINT ["tls-entrypoint.sh"]
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
