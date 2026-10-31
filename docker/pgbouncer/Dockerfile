# syntax=docker/dockerfile:1.7
# PgBouncer in transaction mode between the app and Postgres. Built from the
# Postgres image for the PGDG package (a current PgBouncer with prepared-statement
# support) and a matching psql for debugging.
FROM postgres:16-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbouncer openssl \
 && rm -rf /var/lib/apt/lists/* \
 && install -d -o postgres -g postgres /etc/pgbouncer/tls /var/run/pgbouncer
COPY docker/pgbouncer/pgbouncer.ini /etc/pgbouncer/pgbouncer.ini
COPY docker/pgbouncer/entrypoint.sh /usr/local/bin/pgbouncer-entrypoint.sh
USER postgres
EXPOSE 6432
HEALTHCHECK --interval=10s --timeout=3s CMD pg_isready -h 127.0.0.1 -p 6432 || exit 1
ENTRYPOINT ["pgbouncer-entrypoint.sh"]
