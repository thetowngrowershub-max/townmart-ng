# TownMart

**Everything your town sells, in one place.** A multi-vendor marketplace for Nigeria: products from retailers, supermarkets, vendors and farm producers, and bookable services from providers and artisans, with a customer storefront, a seller dashboard and an admin console.

TownMart owns its whole data layer: PostgreSQL 16, Redis 7 and S3-compatible storage, all self-hosted. There is no Backend-as-a-Service.

> **Status:** Phase 0 (Foundations) of the build plan in `TOWNMART_BUILD_PROMPT.md`. See [DEFERRED.md](DEFERRED.md) for what each later phase adds.

## Quick start

Requirements: Node 22, pnpm 10 (`corepack enable`), Docker.

```bash
cp .env.example .env          # then replace the three "replace-me" secrets (openssl rand -base64 32)
docker compose up -d          # Postgres, Redis, MinIO, Mailpit — creates DB roles on first start
pnpm install
pnpm db:migrate               # applies migrations as townmart_migrator
pnpm db:seed                  # states + LGAs, settings, admin accounts (passwords printed in dev)
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

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm worker` | BullMQ worker (`worker/`) |
| `pnpm lint` / `pnpm typecheck` | ESLint, `tsc --noEmit` (strict) |
| `pnpm test` | Unit tests (no database needed) |
| `pnpm test:db` | Database tests: RLS isolation, roles, append-only audit log, conventions. Needs a migrated, seeded DB |
| `pnpm db:bootstrap` | Creates roles and the database on an existing server (superuser) |
| `pnpm db:migrate` / `pnpm db:deploy` | `prisma migrate dev` / `deploy` |
| `pnpm db:seed` | Idempotent seed |

## Project layout

```
app/
  (storefront)/   home, auth pages        (account)/account/*   customer area
  (dashboard)/    seller dashboard        (admin)/admin/*, /design-system
  api/            Auth.js handlers, /api/health
components/       ui/ (shadcn-style primitives), layout/, auth/, account/
lib/
  db/             Prisma client + withRls() RLS context helper
  authz/          central permission policy: can(), assertCan()
  auth/           Auth.js config, password sign-in, sessions, Server Actions
  crypto/         AES-256-GCM column encryption, keyed lookup hashes
  notifications/  EmailProvider (SMTP/Mailpit, Resend) + templates
  queue/ redis.ts rate-limit.ts audit.ts money.ts datetime.ts env.ts
prisma/           schema.prisma, migrations/, seed.ts, data/ (states + LGAs)
sql/bootstrap/    cluster bootstrap run once as superuser (roles, database)
worker/           BullMQ worker and jobs
tests/            unit/ and db/
scripts/db/       bootstrap.sh, rotate-keys.md
```

More detail: [ARCHITECTURE.md](ARCHITECTURE.md) and [DATABASE.md](DATABASE.md).

## Conventions

- Money is integer kobo (`BigInt`), formatted with `formatNaira()` as `₦12,500.00`.
- Timestamps are `timestamptz` (UTC) and displayed in `Africa/Lagos`.
- Every Server Action: Zod validation → `authz` check → DB transaction via `withRls()`.
- Secrets only come from environment variables; `.env.example` lists them all.
