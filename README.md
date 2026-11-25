# TownMart

**Everything your town sells, in one place.** A multi-vendor marketplace for Nigeria: products from retailers, supermarkets, vendors and farm producers, and bookable services from providers and artisans, with a customer storefront, a seller dashboard and an admin console.

TownMart owns its whole data layer: PostgreSQL 16, Redis 7 and S3-compatible storage, all self-hosted. There is no Backend-as-a-Service.

> **Status:** All nine phases (0 to 8) of the build plan in `TOWNMART_BUILD_PROMPT.md`: foundations; sellers, catalogue and search; promotions; cart, checkout and payments; fulfilment, bookings and reviews; refunds, disputes and payouts; legal pages, consent and privacy; admin console and analytics; hardening and operations. [DEPLOYMENT.md](DEPLOYMENT.md) covers going live, [SECURITY.md](SECURITY.md) the security review, and [DEFERRED.md](DEFERRED.md) what is left before and after launch.

## Quick start

Requirements: Node 22, pnpm 10 (`corepack enable`), Docker.

```bash
cp .env.example .env          # then replace the three "replace-me" secrets (openssl rand -base64 32)
docker compose up -d          # Postgres, Redis, MinIO, Mailpit — creates DB roles on first start
pnpm install
pnpm db:migrate               # applies migrations as townmart_migrator
pnpm db:seed                  # states + LGAs, settings, categories, admin accounts and demo sellers (passwords printed in dev)
pnpm dev                      # http://localhost:3000
pnpm worker                   # in a second terminal: emails and scheduled jobs
```

| Service | URL |
|---|---|
| App | http://localhost:3000 |
| Mailpit (local inbox) | http://localhost:8025 |
| MinIO console | http://localhost:9001 |
| Prisma Studio | `pnpm db:studio` |

To run the app and worker inside Docker too: `docker compose --profile app up -d`.

Without Docker (an existing Postgres 16 server): set the `POSTGRES_*` superuser variables in `.env` and run `pnpm db:bootstrap` once instead of `docker compose up`.

### Seeded accounts (development)

`pnpm db:seed` creates `admin@townmart.local` and `superadmin@townmart.local` and prints random passwords once. Set `SEED_ADMIN_PASSWORD` / `SEED_SUPER_ADMIN_PASSWORD` to choose them. In production these variables are required and passwords are never printed.

It also seeds the category tree and six approved demo sellers in Lagos, Ogun and Oyo (59 products with variants and stock, 10 services, generated placeholder images), and prints each owner's email and password once. Demo data is skipped in production unless `SEED_DEMO_DATA=true`.

Demo promotions start at the hour the seed runs: flash deals on rice (Ikeja Fresh Mart) and tomatoes (Ogun Harvest Farms) that end within two days, money off selected gadgets and plumbing services, and coupon codes `IKEJAFRESH10` and `YABA15`. A store that already has promotions is skipped, so to refresh expired demo deals, delete that store's promotions and seed again.

It also creates a demo shopper (`bola@demo.townmart.ng`, password printed once) with orders through the real checkout: a delivered and reviewed grocery order, a pay-on-delivery order waiting to be sent, a plumbing request waiting for the provider to confirm, an upcoming tailoring booking, and a completed, reviewed one. Skipped if the shopper already exists. With the fake payment and transfer providers it then adds a returned Yaba Threads item (refunded after the money reached Yaba Threads, which is then paid out), a cancelled and refunded phone case, and a declined power-bank refund now in an open dispute for TownMart to decide.

Local development drivers: `STORAGE_DRIVER=local` (files under `LOCAL_STORAGE_DIR`, no MinIO needed), `SMS_PROVIDER=console` (codes appear in the worker log) and `BANK_VERIFIER=fake` (any 10-digit account resolves to `TEST ACCOUNT nnnn`) and `PAYMENT_PROVIDER=fake` (checkout goes to a local test payment page with Pay and Decline buttons; set `paystack` with test keys to use Paystack's sandbox). `next start` refuses to run with any of these.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm worker` | BullMQ worker (`worker/`) |
| `pnpm lint` / `pnpm typecheck` | ESLint, `tsc --noEmit` (strict) |
| `pnpm test` | Unit tests (no database needed) |
| `pnpm test:db` | Database tests: RLS and cross-seller isolation, order and booking status guards, overselling and double booking, verified reviews, refunds, disputes, escrow and payouts, policy acceptances and consent, account deletion and retention jobs, moderation and take-downs, questions, staff invitations, CMS and reference-data writes, stock, search, append-only logs, encrypted columns, conventions. Needs a migrated, seeded DB |
| `pnpm test:e2e` | Playwright browser tests on a phone-sized screen: a guest purchase, a refund after delivery, a booking confirmed by the provider, and an axe accessibility audit of 32 pages. Needs the app and worker running with `PAYMENT_PROVIDER=fake` and the demo seed (see `playwright.config.ts`) |
| `pnpm load:oversell` | Overselling load test: 50 buyers in separate processes race for 10 units, then each order is paid through three duplicate webhooks. Checks nothing is oversold or paid twice and the ledger balances. Options `--buyers`, `--stock`, `--no-webhooks` |
| `pnpm db:bootstrap` | Creates roles and the database on an existing server (superuser) |
| `pnpm db:migrate` / `pnpm db:deploy` | `prisma migrate dev` / `deploy` |
| `pnpm db:seed` | Idempotent seed |

## Production

`docker-compose.prod.yml` runs the whole stack on one server: Caddy (HTTPS), the app and worker, PgBouncer, Postgres with TLS and point-in-time recovery, Redis and a backup service with nightly encrypted dumps and a monthly restore drill. Step by step: [DEPLOYMENT.md](DEPLOYMENT.md). Restore runbooks: [DATABASE.md](DATABASE.md#backups-and-restore).

Lighthouse (mobile, production build, Phase 8): home 99 / 100 / 100 / 100 (performance, accessibility, best practices, SEO); product page 94 / 100 / 100 / 100; service page 94 / 100 / 100 / 100; store page 98 / 100 / 100 / 100; search 95 / 100 / 100 / 66, because search results are `noindex` on purpose.

## Project layout

```
app/
  (storefront)/   home, auth, /search, /c/*, /p/*, /s/*, /store/*, /sell (onboarding), /legal/*
  (account)/      customer area           (dashboard)/dashboard/*   seller dashboard     (print)/  packing slips
  (admin)/        admin console, seller approvals, /design-system
  api/            Auth.js, health, storage upload/read, KYC document links, product CSV export
components/       ui/, layout/, auth/, account/, seller/, admin/, storefront/, uploads/, editor/
lib/
  db/             Prisma client + withRls() RLS context helper
  authz/          central permission policy: can(), assertCan()
  auth/           Auth.js config, password sign-in, sessions, Server Actions
  crypto/         AES-256-GCM column encryption, keyed lookup hashes
  notifications/  EmailProvider (SMTP/Mailpit, Resend), SmsProvider (Termii, console) + templates
  catalogue/      products, services, stock, CSV import/export, storefront queries
  search/         SearchProvider interface + Postgres full-text/trigram implementation
  seller/         onboarding state and actions, seller context    admin/  seller review
  storage/        StorageProvider (S3/MinIO, local), presigned uploads, image processing
  payments/       Paystack, Flutterwave and test payment providers; bank account verification
  checkout/       cart pricing, delivery quotes and totals
  orders/         placing orders, confirming payments, receipts
  fulfilment/     seller order steps, messages, notices      bookings/  slot engine, claims, booking changes, reminders
  reviews/        verified reviews, replies, reports          wishlist/ delivery/  saved items, seller delivery rates
  ledger/         double-entry postings
  queue/ redis.ts rate-limit.ts audit.ts money.ts datetime.ts env.ts
prisma/           schema.prisma, migrations/, seed.ts, seed-catalogue.ts, data/ (states + LGAs, demo catalogue)
sql/bootstrap/    cluster bootstrap run once as superuser (roles, database)
worker/           BullMQ worker and jobs
tests/            unit/ and db/
scripts/db/       bootstrap.sh, rotate-keys.md
```

More detail: [ARCHITECTURE.md](ARCHITECTURE.md) and [DATABASE.md](DATABASE.md).

## Conventions

- Money is integer kobo (`BigInt`), formatted with `formatNaira()` as `₦12,500.00` (or `formatPrice()` on price tags: `₦12,500`).
- Timestamps are `timestamptz` (UTC) and displayed in `Africa/Lagos`; `datetime-local` form values are read as Lagos time (`lagosLocalToDate`).
- Every Server Action: Zod validation → `authz` check → DB transaction via `withRls()`.
- Secrets only come from environment variables; `.env.example` lists them all.
