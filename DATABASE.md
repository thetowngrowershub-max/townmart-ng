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
| `app.current_cart_id` | `app_current_cart_id()` | a guest's cart (from Phase 3) |
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

Phase 2 policies:

| Table | Read | Write |
|---|---|---|
| `promotions` | active, not ended, from an approved store or platform-wide; or the current business | current business. Platform-wide (`business_id` NULL) needs admin/system. `has_coupon` and `redemption_count` are kept by triggers; a direct change is rejected (`guard_promotion_counters`) |
| `promotion_targets` | when the promotion is readable | current business. `business_id` is copied from the promotion by a trigger, and composite foreign keys `(product_id, business_id)` / `(service_id, business_id)` stop a target pointing at another seller's listing |
| `coupons` | current business only (codes are never public) | current business. Codes are `citext`, unique across TownMart |
| `promotion_redemptions` | the store, the customer, or admin/system | insert admin/system only (checkout); `UPDATE`/`DELETE` revoked from `townmart_app`. Inserting one bumps the promotion's `redemption_count` |

`tests/db/promotions-rls.test.ts` proves these: seller A can't see B's paused promotions or any of B's coupons; can't update, delete or create B's promotions, create platform-wide ones, attach targets to B's promotion or put B's product in its own; can't set its own counters; and can't write, edit or delete redemptions.

`tests/db/catalogue-rls.test.ts` proves these: seller A can't read B's drafts, KYC, payout account or import jobs; can't update, delete or insert B's listings, variants or payouts; can't adjust B's stock; can't approve itself, start a business as approved, verify its own KYC or set its rating; and guests and search see only live listings of approved sellers.

Phase 3 policies:

| Table | Read | Write |
|---|---|---|
| `carts`, `cart_items` | the signed-in owner, or the guest whose cart is `app.current_cart_id` | same |
| `orders` | the customer who placed it | admin/system only (checkout runs in the system scope) |
| `seller_orders`, `order_items`, `order_status_history` | the seller for its own rows, or the customer through their order | admin/system only; status history is append-only |
| `stock_reservations` | the seller for its own rows | admin/system only |
| `payments` | the customer through their order | admin/system only |
| `payment_events` | admin/system only | admin/system only; only `processed_at` and `error` can be updated |
| `ledger_accounts`, `ledger_entries` | the seller for its own accounts and entries | insert admin/system only; `UPDATE`/`DELETE`/`TRUNCATE` revoked, `UPDATE` blocked by trigger |
| `ledger_transactions` | the seller when one of its entries is in it | insert admin/system only |
| `delivery_zones`, `delivery_rates` | public | zones admin/system; a seller may write its own rates |
| `commission_rules` | global rules, the seller's own, admin/system | admin/system |
| `notifications` | the recipient | insert admin/system; the recipient may update `read_at` only |

A seller never reads the `orders` row: it holds the customer's contact details and other sellers' totals. The order number and pay-on-delivery flag are copied onto `seller_orders` for the seller's view.

Money tables carry check constraints: an order's total must equal subtotal − discount + delivery + service fee + VAT, and likewise for seller orders and items; a ledger entry is a positive debit or a positive credit, never both. The constraint trigger `ledger_check_balanced` (deferred to commit) rejects any ledger transaction that doesn't balance.

`tests/db/checkout.test.ts` proves: a two-seller checkout splits correctly and holds stock; a changed total is refused; 50 concurrent buyers for 10 units produce exactly 10 orders; a payment is applied once (replayed webhooks are stored once and processed once), a wrong amount is not accepted; the ledger balances and rejects unbalanced or edited entries; expiry puts stock back; a seller sees only its own part of a shared order and its own ledger; shoppers see only their own orders and payments; guest carts are kept apart.

Phase 4 policies:

| Table | Read | Write |
|---|---|---|
| `bookings` | the provider, the customer (by `customer_user_id` or through their order) | insert/delete admin/system (checkout). The provider may update `status`, `cancel_reason` and reminder columns only (column grants); `guard_booking_status` allows requested → confirmed → in progress → completed and confirmed → no-show; `guard_booking_time` rejects a change of time or place outside admin/system |
| `booking_status_history` | the provider, or whoever can read the booking | the provider for its own bookings, admin/system; append-only |
| `seller_orders` (Phase 4 additions) | as Phase 3 | the seller may update status, tracking and fulfilment dates only (column grants); `guard_seller_order_status` allows paid → processing → shipped/ready for pickup → delivered |
| `messages` | the seller, the customer through their order | the seller as `seller` for its own orders, the customer as `customer` on their own order; append-only apart from `read_at` |
| `reviews` | published and reported reviews publicly; hidden ones to the author, the seller and admin/system | insert/delete admin/system (after the verified-purchase check). The seller may update its reply only (column grants); `guard_review_update` keeps status and report fields to TownMart |
| `wishlist_items` | the owner | the owner |

`refresh_ratings(business, product, service)` recomputes ratings from reviews that aren't hidden; rating columns stay writable only by TownMart (Phase 1 trigger).

`tests/db/fulfilment.test.ts` proves: 8 shoppers racing for a 2-place slot produce exactly 2 bookings, and the exclusion constraint rejects an overlapping place even without the app's checks; a seller can only take its forward steps on an order and a provider on a booking, can't move a booking's time or change its price, and can't touch another seller's order; bookings and conversations are visible only to their provider/seller and customer, and nobody can post into someone else's conversation, as someone else, or edit messages; only the buyer can review, only after delivery, once, with their own photos; the seller can reply but not change the rating or status; hidden reviews are hidden from guests and strangers; wishlists are private.

Phase 5 policies:

| Table | Read | Write |
|---|---|---|
| `refunds`, `refund_items` | the seller for its own rows, the customer through their order, admin/system | admin/system only (decisions run in the system scope after the authz check). Check constraints keep the split consistent: an approved refund's seller debit = amount + returned TownMart discount − returned commission, and amounts are never negative |
| `disputes` | the seller, the customer through their order, admin/system | admin/system only |
| `dispute_messages` | whoever can read the dispute | the seller as `seller` and the customer as `customer`, on an open dispute about their own order; admin/system. Append-only (`UPDATE`/`DELETE` revoked and blocked by trigger) |
| `payouts` | the seller for its own payouts, admin/system | admin/system only |
| `seller_orders` (Phase 5 addition) | as before | `escrow_released_at` can only be set by TownMart (`guard_seller_order_money`) |

Unique partial indexes allow one open refund request and one open dispute per seller order, and one payout in flight per business. `refund_number_seq` numbers refunds `RF-YYYY-NNNNNN`.

`tests/db/payouts.test.ts` proves: cancelling refunds everything, restocks and empties the seller's escrow; partial returns split the money in proportion, escrow is released once and later refunds come from the available balance, with the ledger balanced throughout; a declined refund escalates to a dispute that TownMart decides; booking cancellations refund by the policy; pay-on-delivery orders settle commission and fees from the seller's balance; a payout pays the balance once and a failed transfer puts it back; an unusable payment is refunded once; a declined provider refund can be retried; and seller A can't read B's refunds, disputes or payouts, can't write refunds, payouts or escrow release at all, and can't post into B's dispute, someone else's as a customer, or as TownMart, nor edit messages.

Phase 6 policies:

| Table | Read | Write |
|---|---|---|
| `legal_documents` | everyone | admin/system only. A version is never edited: publishing adds a row (`slug`, `version` unique) |
| `policy_acceptances` | the user, the business owner for its own onboarding, admin/system | the signed-in user for themselves (and their own business), a guest only with an order id, admin/system. Append-only (`UPDATE`/`DELETE`/`TRUNCATE` revoked) |
| `consent_records` | the signed-in user for their own, admin/system | admin/system only (the cookie banner action writes in the system scope after rate limiting). Append-only |
| `notification_preferences` | the user | the user |
| `data_subject_requests` | the requester (by `user_id`), admin/system | admin/system only. A unique partial index allows one open erasure request per account |
| `marketing_suppressions`, `breach_incidents`, `processing_activities`, `data_processors`, `dpia_records`, `retention_settings` | admin/system only | admin/system only |
| `reviews` (Phase 6 addition) | as before | `author_name` is granted to the app so anonymising can replace it, but `guard_review_author` allows the change only in admin/system scope |

`next_dsr_reference()` numbers requests `DSR-YYYY-NNNNNN` and `next_breach_reference()` breaches `BR-YYYY-NNNN`. Partial indexes `users_unverified` and `users_pending_deletion` keep the retention jobs cheap.

`tests/db/compliance.test.ts` proves: acceptances are recorded with the current versions at sign-up, checkout (guest and signed in) and seller onboarding, and nobody can edit or delete them or consent records; users see only their own acceptances, consent records and data requests, and can't write the compliance tables; a deletion request can be undone by signing in within the grace period, and anonymising removes personal data, keeps the order with the money unchanged, renames reviews to "Former customer" and suppresses marketing to the old address; the retention jobs remove abandoned carts, unverified accounts (never staff or anyone with an order), old logs and unconfirmed requests, and nothing else; the marketing audience skips suppressed addresses; the export collects the account's data.

Phase 7 policies:

| Table | Read | Write |
|---|---|---|
| `products`, `services` (Phase 7 addition) | a taken-down listing is hidden from the public; its own shop and admin/system still see it | `taken_down_at`, `taken_down_by` and `taken_down_reason` can only be set or cleared by TownMart (`guard_listing_takedown`) |
| `listing_reports` | the reporter, admin/system | the signed-in reporter (open, never `keyword_match`), admin/system. One open report per person per listing, one open keyword flag per listing |
| `listing_questions` | everyone once answered on a visible listing; the asker; the shop; admin/system | the asker inserts; the shop may update only the answer columns (column grants); hiding is admin/system only (`guard_question_update`) |
| `staff_invitations` | the shop (owner context), admin/system | the shop, admin/system. Accepting runs in the system scope after checking the token and the signed-in email. One pending invitation per email per shop; tokens stored as SHA-256 |
| `cms_banners` | everyone while active and in its window; admin/system | admin/system only |
| `faq_entries` | everyone when published; admin/system | admin/system only |
| `featured_stores`, `cms_pages` | everyone | admin/system only |
| `ops_events` | admin/system only | admin/system only. Append-only (`UPDATE`/`DELETE`/`TRUNCATE` revoked) |
| `categories`, `attributes`, `category_attributes`, `settings` | everyone | admin/system only (the admin console now edits them) |

`tests/db/admin-console.test.ts` proves: a seller can't take its own listing down or restore it, and a taken-down listing disappears from the public but not from its shop; closing a report and the keyword flag work once; reports are visible only to the reporter and TownMart; questions are public only once answered, and a shop can answer only its own and can't hide them; seller A can't see or write B's staff invitations; unpublished CMS content stays hidden; sellers and customers can't write categories, attributes, settings or CMS tables; ops events can't be edited or deleted; attributes are inherited and validated by `saveProduct`; and the analytics daily series adds up to the totals.

Tables without RLS: Auth.js tables (`users`, `accounts`, `sessions`, `verification_tokens`), `otp_codes`, reference data (states, LGAs), `job_runs`.

RLS is defence in depth. The application `authz` check always runs first.

**Gotcha:** an `INSERT … RETURNING` must also pass the table's `SELECT` policy. That's why `writeAudit()` uses `createMany` (no `RETURNING`): ordinary users may append audit rows but not read them.

## Audit log

`audit_logs` is append-only:
- `UPDATE`, `DELETE`, `TRUNCATE` are revoked from `townmart_app`;
- triggers raise an error on `UPDATE`/`DELETE`/`TRUNCATE` for **every** role, including the owner;
- `actor_user_id` has no foreign key, so deleting or anonymising a user never rewrites audit history;
- `before`/`after` are passed through `redact()` (passwords, tokens, hashes, phone numbers, addresses, card/BVN/NIN fields).

## Encryption and hashing

- Column-level encryption: `lib/crypto` AES-256-GCM, format `v1.<keyId>.<iv>.<tag>.<ciphertext>`, key id bound into the authenticated data.
- Lookups on encrypted values use keyed HMAC-SHA256 hashes with a separate `DATA_HASH_KEY`.
- Key rotation: [scripts/db/rotate-keys.md](scripts/db/rotate-keys.md).

### Personal data and how each column is protected (Phase 6 audit)

| Column | Holds | Protection |
|---|---|---|
| `users.phone_encrypted` / `users.phone_hash` | sign-in phone number | encrypted; HMAC for lookup |
| `users.password_hash` | password | argon2id |
| `addresses.phone_encrypted`, `line1_encrypted`, `line2_encrypted` | delivery phone and street | encrypted (city, LGA, state and landmark are plain for delivery pricing) |
| `orders.contact_phone_encrypted` | order phone | encrypted |
| `orders.shipping_address_snapshot`, `seller_orders.fulfilment_contact` (JSON) | address at the time of the order | `phoneEncrypted`, `line1Encrypted`, `line2Encrypted` keys encrypted |
| `businesses.phone_encrypted` / `phone_hash`, `address_encrypted` | seller contact and address | encrypted; HMAC for lookup |
| `store_policies.pickup_address_encrypted` | pickup address | encrypted |
| `business_kyc.provider_reference_encrypted` | identity provider reference | encrypted. Raw BVN/NIN is never stored; KYC documents sit in the private bucket and open through 60-second signed URLs, each view audited |
| `payout_accounts.account_number_last4`, `payouts.account_number_last4` | bank account | last 4 digits only; the full number stays with Paystack |
| `orders.access_token_hash`, `carts.guest_token_hash`, `otp_codes.code_hash` | guest links, one-time codes | hashed, never stored in plain |
| `*.ip_hash` (audit logs, sessions, orders, acceptances, consent, data requests) | IP address | HMAC only |
| `users.email`, `name`; `orders.contact_email`, `customer_name`; `data_subject_requests.email`, `name` | needed in plain to sign in, send receipts and answer requests | plain; orders and requests are behind RLS, and anonymisation removes them from the account |

`tests/db/schema-conventions.test.ts` checks every `*_encrypted` column, and every `*Encrypted` key in every JSON column, holds `v1` ciphertext, so a new column written in plain fails the build.

## Reference data

`prisma/data/nigeria-states-lgas.json`: 36 states + FCT (ISO 3166-2:NG codes) and 774 LGAs, seeded by `prisma/seed.ts`. A composite foreign key `(lga_id, state_id) → lgas(id, state_id)` guarantees an address's LGA belongs to its state.

## Backups and restore

Two independent kinds of backup, both encrypted, both copied to a second location, and both run by the `backup` service in `docker-compose.prod.yml` (`scripts/db/scheduler.sh`). DEPLOYMENT.md covers setting them up.

| | pgBackRest (point-in-time recovery) | Nightly dump (`scripts/db/backup.sh`) |
|---|---|---|
| What | Physical backups plus every WAL segment, archived at least every 60 seconds | `pg_dump -Fc` of one consistent snapshot, with each table's row count taken in the same snapshot |
| When | Full on Sundays, differential other days, 01:00 Lagos | 01:30 Lagos |
| Encryption | AES-256 (`PGBACKREST_REPO1_CIPHER_PASS`) | age, to the public key(s) in `BACKUP_AGE_RECIPIENTS`; the private key stays offline |
| Second location | `PGBACKREST_REPO2_*` (S3-compatible) | `BACKUP_OFFSITE` (any rclone remote) |
| Kept | 3 full backups and all WAL between | 14 daily, 8 weekly, 12 monthly |
| Good for | Going back to a moment before a mistake | A portable copy that restores anywhere; the monthly drill |

**Targets:** RPO about 1 minute (at most 15), RTO 2 hours.

**Restore drill:** at 04:00 on the 1st of each month, `scripts/db/verify-restore.sh` takes the newest dump (from the second location when one is configured), restores it into a scratch database, compares every table's row count with the counts saved at backup time, drops the scratch database and records the result. CI runs the same drill on every push.

**Records:** every backup and drill, good or bad, writes a row to `ops_events` (as the superuser; the app roles can only read it). `/admin/system` shows the last of each, with its size and details. `pnpm ops:record` stays available for backups taken by hand.

### Restore runbook: a dump into a new database

Use this to recover from a lost server, or to look at old data next to the live database.

```sh
export COMPOSE_FILE=docker-compose.prod.yml
# 1. Pick a dump (local, or fetch from the second location with rclone).
docker compose exec -u postgres backup ls /var/backups/townmart/daily
# 2. Restore it into a NEW database. It checks the checksum and never touches an existing database.
docker compose exec -u postgres backup /opt/townmart/scripts/db/restore.sh dump \
  /var/backups/townmart/daily/townmart-20261102T003000Z.dump.age townmart_restored
```

To put it live:

```sh
docker compose stop web worker pgbouncer
docker compose exec -u postgres postgres psql -c 'ALTER DATABASE townmart RENAME TO townmart_before_restore' \
                                            -c 'ALTER DATABASE townmart_restored RENAME TO townmart'
docker compose start pgbouncer web worker
```

Keep `townmart_before_restore` until you're sure, then drop it. On a brand-new server, follow DEPLOYMENT.md up to "First deploy", start only `postgres` (it creates the roles), restore as above straight into the name `townmart` after dropping the empty one, then start the rest. Don't run `migrate pnpm db:seed` on a restored database.

### Restore runbook: point in time

Use this after a mistake (a bad migration, a mass delete): it rebuilds the database as it was at a moment you choose, losing everything after it.

```sh
export COMPOSE_FILE=docker-compose.prod.yml
# 1. Find the moment just before the mistake (audit_logs, app logs). Use a time with its zone.
# 2. Take a dump of the current state, in case you need something from after that moment.
docker compose exec -u postgres backup /opt/townmart/scripts/db/backup.sh
# 3. Stop everything that uses the database, and the database itself.
docker compose stop web worker backup pgbouncer postgres
# 4. Restore. This rewrites the data directory, replays WAL up to the target and promotes.
docker compose run --rm --no-deps -u postgres --entrypoint "" -e PGDATA=/var/lib/postgresql/data \
  postgres /opt/townmart/scripts/db/restore.sh pitr "2026-11-02 14:29:00+01"
# 5. Start the database and check the data before letting traffic in.
docker compose up -d --wait postgres
docker compose exec -u postgres postgres psql -d townmart -c 'SELECT max(created_at) FROM orders'
docker compose up -d --wait pgbouncer web worker backup
```

After a point-in-time restore Postgres starts a new timeline; the next scheduled pgBackRest backup covers it. Orders and payments made after the target time are lost from TownMart. Find those payments in the Paystack or Flutterwave dashboard by time, refund them there, and tell the customers and sellers affected.

### Before risky changes

Run a dump first: `docker compose exec -u postgres backup /opt/townmart/scripts/db/backup.sh`. In development, `pg_dump -Fc` is enough.
