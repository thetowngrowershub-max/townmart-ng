# TownMart database

PostgreSQL 16, owned and operated by TownMart. Schema in `prisma/schema.prisma`, versioned migrations in `prisma/migrations/`.

## Roles

| Role | Used by | Can |
|---|---|---|
| superuser (`postgres`) | `sql/bootstrap/roles.sql` only, once per cluster | create roles, the database, `pg_stat_statements` |
| `townmart_migrator` | `prisma migrate`, `prisma db seed` | owns the `public` schema and every table. `CREATEDB` only for `prisma migrate dev` shadow databases; remove it in production (`ALTER ROLE townmart_migrator NOCREATEDB`) |
| `townmart_app` | web app and worker (`DATABASE_URL`) | `SELECT/INSERT/UPDATE/DELETE` via default privileges. **Not** superuser, **NOBYPASSRLS**, owns nothing (owners bypass RLS). Read-only on `states`/`lgas`; no `UPDATE/DELETE/TRUNCATE` on `audit_logs` |
| `townmart_readonly` | analytics and reporting | `SELECT` only, subject to RLS |

Default privileges are set in the first migration (`ALTER DEFAULT PRIVILEGES FOR ROLE townmart_migrator …`), so tables created by later migrations get the same grants automatically.

`tests/db/schema-conventions.test.ts` asserts the app role is not a superuser, cannot bypass RLS and owns no tables.

## Conventions

- **Primary keys:** UUID v7 from `uuid_generate_v7()` (defined in the first migration; Postgres 16 has no built-in). Reference tables (`states`, `lgas`) use `smallint`.
- **Timestamps:** `timestamptz`. `updated_at` is set by the Prisma client **and** by the `trg_set_updated_at` trigger, so raw SQL updates are covered. New tables: `SELECT attach_updated_at_trigger('new_table');` in the migration. A test fails if any table with `updated_at` lacks the trigger.
- **Money:** `bigint` kobo. **Quantities:** `numeric(12,3)` where fractional units are allowed.
- **Foreign keys:** explicit `ON DELETE`, and every FK is indexed (also enforced by a test).
- **Names:** snake_case via `@@map`/`@map`.
- **Extensions:** `pgcrypto`, `citext`, `pg_trgm`, `btree_gist` (created by the first migration; all are "trusted" so the DB owner can create them) and `pg_stat_statements` (created by the bootstrap as superuser; needs `shared_preload_libraries`).

## Raw SQL alongside Prisma

Prisma generates the DDL for tables, enums, indexes and foreign keys. Anything it can't express is appended to the same migration under a `Raw SQL that Prisma cannot express` banner: RLS policies, triggers, check constraints, partial indexes and grants. Prisma doesn't diff these, so they never cause drift. CI checks that `schema.prisma` and the migrations agree (`prisma migrate diff --exit-code`).

Migrations are forward-only in production. Never edit a migration that has been applied anywhere outside your machine; add a new one.

## Row-level security

`lib/db/rls.ts` → `withRls(ctx, fn)` opens a transaction and sets:

| Setting | Read by | Meaning |
|---|---|---|
| `app.current_user_id` | `app_current_user_id()` | signed-in user, or empty |
| `app.current_business_id` | `app_current_business_id()` | seller business being acted for (from Phase 1) |
| `app.current_scope` | `app_current_scope()`, `app_is_privileged()` | `user` (default), `admin` (admin console, after an authz check), `system` (worker jobs) |

Settings use `set_config(name, value, true)`, i.e. transaction-local. They can't leak to the next request on a pooled connection, including through PgBouncer in transaction mode (a test checks this).

Phase 0 policies:

| Table | Policy |
|---|---|
| `addresses` | owner only, for read and write (`WITH CHECK` stops moving a row to another user); admin/system see all |
| `user_roles` | read own roles; a user may insert only `customer` for themselves (sign-up); any other write needs admin/system scope |
| `audit_logs` | anyone may append; only admin/system may read |

Phase 1 policies (tenant isolation on `business_id = app_current_business_id()`):

| Table | Read | Write |
|---|---|---|
| `businesses` | approved stores publicly; own business (owner or current business) | owner/current business; `DELETE` admin/system only. Status, review and rating changes need admin/system (trigger) |
| `business_staff` | own membership rows and the current business | current business |
| `business_kyc`, `payout_accounts`, `import_jobs` | current business only | current business only. KYC `verified`/`failed` needs admin/system (trigger) |
| `store_policies` | public | current business |
| `products`, `services` | active, not deleted, business approved; or the current business | current business |
| `product_images`, `product_options`, `product_variants`, `service_packages`, `service_images`, `service_availability`, `service_blackouts` | when the parent is readable | current business. Composite foreign keys `(parent_id, business_id)` stop a child pointing at another seller's parent |
| `stock_movements` | current business | insert only; `UPDATE`/`DELETE` revoked from `townmart_app` |

Categories and category attributes are public reference data, written by admins.

`tests/db/catalogue-rls.test.ts` proves these: seller A can't read B's drafts, KYC, payout account or import jobs; can't update, delete or insert B's listings, variants or payouts; can't adjust B's stock; can't approve itself, start a business as approved, verify its own KYC or set its rating; and guests and search see only live listings of approved sellers.

Tables without RLS: Auth.js tables (`users`, `accounts`, `sessions`, `verification_tokens`), `otp_codes`, reference data (states, LGAs, categories), `settings`, `job_runs`.

RLS is defence in depth. The application `authz` check always runs first.

**Gotcha:** an `INSERT … RETURNING` must also pass the table's `SELECT` policy. That's why `writeAudit()` uses `createMany` (no `RETURNING`): ordinary users may append audit rows but not read them.

## Audit log

`audit_logs` is append-only:
- `UPDATE`, `DELETE`, `TRUNCATE` are revoked from `townmart_app`;
- triggers raise an error on `UPDATE`/`DELETE`/`TRUNCATE` for **every** role, including the owner;
- `actor_user_id` has no foreign key, so deleting or anonymising a user never rewrites audit history;
- `before`/`after` are passed through `redact()` (passwords, tokens, hashes, phone numbers, addresses, card/BVN/NIN fields).

## Encryption and hashing

- Column-level encryption: `lib/crypto` AES-256-GCM, format `v1.<keyId>.<iv>.<tag>.<ciphertext>`, key id bound into the authenticated data. Used for `*_encrypted` columns (phone numbers, address lines, business phone and address, KYC provider references). Full bank account numbers are never stored: only the last 4 digits and Paystack's subaccount code.
- Lookups on encrypted values use keyed HMAC-SHA256 hashes (`phone_hash`, `ip_hash`) with a separate `DATA_HASH_KEY`.
- Key rotation: [scripts/db/rotate-keys.md](scripts/db/rotate-keys.md).

## Reference data

`prisma/data/nigeria-states-lgas.json`: 36 states + FCT (ISO 3166-2:NG codes) and 774 LGAs, seeded by `prisma/seed.ts`. A composite foreign key `(lga_id, state_id) → lgas(id, state_id)` guarantees an address's LGA belongs to its state.

## Backups and restore

Nightly `pg_dump`, WAL archiving for point-in-time recovery, encrypted off-site copies and monthly automated restore drills are delivered in **Phase 8** (`scripts/db/backup.sh`, `restore.sh`, `verify-restore.sh`), with RPO ≤ 15 minutes and RTO ≤ 2 hours. Until then, use `pg_dump -Fc` manually before risky changes.
