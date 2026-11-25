-- ─────────────────────────────────────────────────────────────────────────────
-- TownMart cluster bootstrap. Runs ONCE as the Postgres superuser.
--   * Docker: executed by docker/postgres/init.sh on first container start.
--   * Elsewhere: `pnpm db:bootstrap` (scripts/db/bootstrap.sh).
-- Requires psql variables: db_name, migrator_password, app_password, readonly_password.
-- Everything after this (tables, grants, RLS, triggers) lives in Prisma migrations
-- and runs as `townmart_migrator`.
-- ─────────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP on

-- Owns the schema and runs migrations. CREATEDB lets `prisma migrate dev` make a
-- shadow database in development; drop it in production with:
--   ALTER ROLE townmart_migrator NOCREATEDB;
SELECT format('CREATE ROLE townmart_migrator LOGIN CREATEDB PASSWORD %L', :'migrator_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'townmart_migrator') \gexec

-- The application role. Not a superuser, cannot bypass row-level security,
-- and does not own any table (owners bypass RLS).
SELECT format('CREATE ROLE townmart_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'townmart_app') \gexec

-- Read-only role for analytics and reporting. Also subject to RLS.
SELECT format('CREATE ROLE townmart_readonly LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L', :'readonly_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'townmart_readonly') \gexec

SELECT format('CREATE DATABASE %I OWNER townmart_migrator', :'db_name')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') \gexec

SELECT format('ALTER DATABASE %I OWNER TO townmart_migrator', :'db_name') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db_name') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO townmart_app, townmart_readonly', :'db_name') \gexec

\connect :db_name

-- pg_stat_statements is not a "trusted" extension, so the superuser creates it.
-- (pgcrypto, citext, pg_trgm and btree_gist are trusted and are created by the
-- first migration as the database owner.)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
GRANT pg_read_all_stats TO townmart_migrator;

-- Only the migrator may create objects in `public`.
ALTER SCHEMA public OWNER TO townmart_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO townmart_app, townmart_readonly;
