# Deploying TownMart

This guide runs TownMart on one Linux server with Docker Compose (`docker-compose.prod.yml`). CI builds and starts this exact stack on every push, takes a backup and runs a restore drill, so the steps below are tested. A section at the end covers the managed-hosting option.

## What runs where

| Service | What it does | Reachable from |
|---|---|---|
| `caddy` | HTTPS (automatic Let's Encrypt certificates), HSTS, compression, static caching | The internet, ports 80 and 443 |
| `web` | The Next.js app | Caddy only |
| `worker` | Background jobs: payments from webhooks, emails, SMS, escrow release, retention | Nothing (it calls out) |
| `pgbouncer` | Connection pool in transaction mode, TLS to Postgres | `web` and `worker` |
| `postgres` | Postgres 16 with TLS-only TCP, `pg_stat_statements` and WAL archiving | The private network |
| `backup` | pgBackRest backups, nightly encrypted dumps, monthly restore drill | Nothing (it calls out) |
| `redis` | Queues, rate limits, sessions cache; password protected | The private network |
| `minio` (optional) | Object storage on the same server | Caddy (media domain) |

Only Caddy publishes ports. A server with 4 vCPUs, 8 GB of memory and 100 GB of SSD is enough for launch. Pick a provider with a Lagos or Johannesburg region, or one in Europe if Nigerian hosting is not required; record the choice on `/admin/compliance` (hosting location and processors), as the privacy policy names it.

## 1. Prepare the server

1. **Ubuntu 24.04 LTS** with full-disk encryption (most providers offer encrypted volumes; turn it on when creating the server and the volume). Encrypted columns and encrypted backups protect the data, and disk encryption covers everything else, such as logs and Redis.
2. Create a non-root user with sudo and SSH key login, and disable password SSH login:
   ```sh
   sudo sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config && sudo systemctl reload ssh
   ```
3. Firewall: allow SSH, 80 and 443 only.
   ```sh
   sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443 && sudo ufw enable
   ```
   Docker publishes ports past ufw, which is why the compose file publishes only Caddy's.
4. Automatic security updates: `sudo apt install unattended-upgrades`.
5. Install Docker Engine and the Compose plugin from Docker's repository (docs.docker.com/engine/install/ubuntu), then add your user to the `docker` group.
6. Set the server's clock zone to UTC (the app works in Africa/Lagos itself): `sudo timedatectl set-timezone UTC`.

## 2. DNS

Point these at the server's IP address (A, and AAAA if it has IPv6):

- `townmart.ng` and `www.townmart.ng` (www redirects to the bare domain)
- `media.townmart.ng`, only if you run MinIO on the server

Caddy gets the certificates on first start, so DNS must resolve first. If Cloudflare proxies the domain, set its SSL mode to "Full (strict)" and add Cloudflare's IP ranges to `trusted_proxies` in `docker/caddy/Caddyfile`, so rate limits see visitors' real addresses.

## 3. Object storage

Use an S3-compatible store: Cloudflare R2, AWS S3, or a Nigerian provider. Create two buckets:

- `townmart-public`: product, service and store images. Public read.
- `townmart-private`: KYC documents, refund photos, exports. No public access.

Set a CORS rule on both allowing `PUT` and `GET` from `https://townmart.ng` (browsers upload straight to storage with presigned URLs).

**Lifecycle rule:** on both buckets, expire objects under the `tmp/` prefix after 1 day. Uploads land in `tmp/` and move to their final key when the form is saved, so this removes abandoned uploads.

To run MinIO on the server instead, leave `S3_ENDPOINT` empty, start the stack with `--profile minio`, create the buckets with `mc`, and set the same lifecycle rule with `mc ilm rule add --prefix tmp/ --expire-days 1`.

## 4. Configuration

```sh
git clone https://github.com/thetowngrowershub-max/townmart-ng.git /opt/townmart
cd /opt/townmart
cp .env.example .env
cp backup.env.example backup.env
chmod 600 .env backup.env
```

In `.env`, set at least:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL`, `AUTH_URL` | `https://townmart.ng` |
| `DOMAIN`, `ACME_EMAIL` | `townmart.ng`, an address Let's Encrypt can warn about expiring certificates |
| `AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `DATA_HASH_KEY` | each `openssl rand -base64 32` |
| `POSTGRES_PASSWORD`, `TOWNMART_MIGRATOR_PASSWORD`, `TOWNMART_APP_PASSWORD`, `TOWNMART_READONLY_PASSWORD`, `REDIS_PASSWORD` | each `openssl rand -base64 24 \| tr -d '/+='` |
| `PAYMENT_PROVIDER`, `PAYSTACK_SECRET_KEY` (and Flutterwave keys if used) | live keys from the provider dashboards |
| `BANK_VERIFIER` | `paystack` |
| `SMS_PROVIDER`, `TERMII_API_KEY`, `TERMII_SENDER_ID`, `TERMII_BASE_URL` | `termii`, the approved sender ID, and the Base URL from the Termii dashboard. `TERMII_CHANNEL` stays `dnd` once Termii has enabled the DND route. Check both with **Admin → System health → Send test text** |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | `resend`, the key, and an address on a domain verified in Resend (SPF, DKIM, DMARC) |
| `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | from Cloudflare Turnstile |
| `S3_*` | your storage endpoint, keys and buckets; `S3_PUBLIC_BASE_URL` is the public bucket's URL |
| `SEED_SUPER_ADMIN_EMAIL`, `SEED_SUPER_ADMIN_PASSWORD` | your own email and a strong password (12+ characters) for the first super admin. There are no shared staff logins on a deployed site. Remove the password after the first deploy |
| `IMAGE_TAG` | a release name, e.g. the git commit (`git rev-parse --short HEAD`) |

The app refuses to start in production with development drivers (local storage, console SMS, fake payments or bank checks), or without the keys those drivers need.

**Payment webhooks.** In the Paystack dashboard set the webhook URL to `https://townmart.ng/api/webhooks/paystack` (Flutterwave: `/api/webhooks/flutterwave`, with the secret hash in `FLUTTERWAVE_WEBHOOK_HASH`).

### Backup keys

On a trusted machine, not the server:

```sh
age-keygen -o backup-age-identity.txt   # prints the public key
```

- Put the **public key** in `BACKUP_AGE_RECIPIENTS` in `backup.env`. Making backups needs only this.
- Keep the **private key** in two safe places offline (a password manager and a printed copy in a safe). Without it the nightly dumps can't be read.
- The monthly restore drill runs on the server and needs the private key there. To keep it off the server, remove `BACKUP_AGE_IDENTITY_FILE` and the secret's mount from the `backup` service and run `scripts/db/verify-restore.sh` monthly from another machine. Otherwise:
  ```sh
  mkdir -p secrets && cp backup-age-identity.txt secrets/
  sudo chown 999:999 secrets/backup-age-identity.txt && sudo chmod 400 secrets/backup-age-identity.txt
  ```
  (999 is the `postgres` user inside the container.)

Set `PGBACKREST_REPO1_CIPHER_PASS` to `openssl rand -base64 48` and store it in the password manager too. Configure a second location for both kinds of backup, in another provider or region: `BACKUP_OFFSITE` with its `RCLONE_CONFIG_OFFSITE_*` settings for the dumps, and the `PGBACKREST_REPO2_*` settings for point-in-time recovery. Set `BACKUP_RUN_ON_START=1` for the first deploy so you see a backup straight away.

## 5. First deploy

```sh
export COMPOSE_FILE=docker-compose.prod.yml
docker compose --profile tools build
docker compose up -d --wait postgres redis pgbouncer
docker compose run --rm migrate                 # apply migrations
docker compose run --rm migrate pnpm db:seed    # reference data, first time only
docker compose up -d --wait web worker caddy backup
```

Then check:

1. `https://townmart.ng/api/health` answers `{"status":"ok",…}` and the home page loads with a padlock.
2. Sign in with `SEED_SUPER_ADMIN_EMAIL` and its password, and turn on two-step sign-in: the admin console stays closed until you do. Give staff their own accounts and roles from the console.
3. `/admin/system` shows a backup and its time. After the first drill (or run one now, below) it shows the restore drill too.
4. Make a ₦100 test purchase with a real card against your own test store, and refund it from the seller dashboard.
5. Fill in the company details on `/admin/compliance/retention` and the processors on `/admin/compliance`, and publish the lawyer-reviewed legal texts.

Remove `BACKUP_RUN_ON_START` from `backup.env` afterwards.

## 6. Backups and restore

`backup` runs on Lagos time:

| When | What | Kept |
|---|---|---|
| Every minute | WAL archived by pgBackRest (point-in-time recovery; RPO about 1 minute, at most 15) | With the full backups |
| 01:00 | pgBackRest full backup on Sundays, differential other days | 3 full backups and everything between |
| 01:30 | `pg_dump` of a consistent snapshot, encrypted with age, copied off-site | 14 daily, 8 weekly, 12 monthly |
| 04:00 on the 1st | Restore drill: restores the newest dump (the off-site copy if configured) into a scratch database and compares every table's row count | Recorded on `/admin/system` |

Every run, good or bad, is recorded and shown on `/admin/system`. Check that page weekly, and set an alert (step 8) for a backup older than 26 hours.

Run a backup or drill by hand:

```sh
docker compose exec -u postgres backup /opt/townmart/scripts/db/backup.sh
docker compose exec -u postgres backup /opt/townmart/scripts/db/verify-restore.sh
docker compose exec -u postgres backup pgbackrest --stanza=townmart info
```

The full runbooks are in DATABASE.md, "Backups and restore": restoring a dump into a new database, point-in-time recovery to a moment before a mistake, and rebuilding on a new server. The target is the service back within 2 hours.

## 7. Updates

```sh
cd /opt/townmart && git pull
export COMPOSE_FILE=docker-compose.prod.yml IMAGE_TAG=$(git rev-parse --short HEAD)
docker compose --profile tools build
docker compose exec -u postgres backup /opt/townmart/scripts/db/backup.sh   # a fresh dump before migrating
docker compose run --rm migrate
docker compose up -d --wait web worker
```

Migrations are forward-only and written to run while the old version still serves traffic. To roll back the code, check out the previous tag and run the last command again; a migration is undone with a new migration, never by editing an old one.

Rotate the data encryption key with the runbook in `scripts/db/rotate-keys.md`. Postgres minor versions arrive with `docker compose build --pull postgres`; a major version upgrade is a planned dump-and-restore.

## 8. Monitoring

- **Uptime:** point an uptime checker (UptimeRobot, Better Stack, or your host's) at `https://townmart.ng/api/health` every minute. It answers 503 when the database or Redis is down.
- **Disk:** alert at 80% on the root disk and the Docker volume disk; the WAL archive and backups grow if off-site copies fail.
- **Backups:** alert if `/admin/system` shows the last backup older than 26 hours or a failed drill. A daily check can query `ops_events`, or use the uptime checker's keyword monitor on that page.
- **Errors:** logs are structured JSON (`docker compose logs web worker`), rotated at 5 × 20 MB per service. Ship them to your log tool, or add an error tracker; the logger is in `lib/logger.ts`.
- **Payments:** Paystack and Flutterwave email failed webhook deliveries; the worker's failed jobs show on `/admin/system` with a retry button.

## Managed hosting (Vercel or similar)

The app also runs on a managed Node host with managed Postgres and Redis:

- Use Postgres 16, and run `sql/bootstrap/roles.sql` (or `pnpm db:bootstrap`) as the database superuser to create the three roles before the first migration. On Vercel with Neon this happens by itself (below).
- Point `DATABASE_URL` at the provider's pooler in **transaction mode** with `?pgbouncer=true`, and `MIGRATE_DATABASE_URL` at a direct connection as `townmart_migrator`. TownMart is safe behind a transaction pooler: all advisory locks are transaction-scoped, and RLS settings are set per transaction.
- Run `pnpm worker` as a separate always-on process (a background worker or a small VM) for a live site. Without one, set `JOBS_INLINE=true` (below).
- Backups then come from the provider's PITR. Still run `scripts/db/backup.sh` and `verify-restore.sh` from a scheduled job elsewhere, so you have a copy outside the provider and proof that it restores.

### Vercel live site

The live site is a **second Vercel project** on the same repository, with its own Neon database, Upstash Redis, R2 buckets and secrets, and `TOWNMART_TEST_MODE` not set. Nothing is shared with the test site except the email, SMS and maps accounts.

What changes without test mode:

- **Only production builds run.** `scripts/vercel/prepare.ts` stops a preview build, so a work-in-progress branch never migrates the live database. Set the project's Ignored Build Step to "Only build production" so previews skip quietly instead of failing.
- **The seed runs as production:** reference data only, no demo shops, orders or accounts, and no test inbox. The first super admin comes from `SEED_SUPER_ADMIN_EMAIL` and `SEED_SUPER_ADMIN_PASSWORD` (12+ characters); the build fails until both are set. The plain admin account is created only if `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` are set too. An existing account with that email keeps its password and is only given the role (once its email is confirmed), so remove the passwords from Vercel after the first deploy.
- **Real providers are required.** The pretend drivers are refused, and so are payment test keys (`FLWSECK_TEST-…`, `sk_test_…`). `DATA_ENCRYPTION_KEY` and `DATA_HASH_KEY` must be set: 32 bytes, base64 or 64 hex characters. Keep a copy somewhere safe, because encrypted phone numbers and addresses can't be read without the first, and lookups break without the second. Turnstile fails closed without `TURNSTILE_SECRET_KEY`.
- **Scheduled jobs need a clock.** Jobs still run inline (no worker), but page views alone are not reliable. Set `CRON_SECRET` (24+ characters) and have a scheduler call `GET /api/jobs/tick` every minute with `Authorization: Bearer <CRON_SECRET>`: cron-job.org works on any Vercel plan, and Vercel Cron sends that header by itself on Pro. Each call starts at most one pass a minute.
- **Setup report.** `/api/health` shows no details on a live site. Set `HEALTH_KEY` (24+ characters) and open `/api/health?key=<HEALTH_KEY>` to see the same report as on the test site (settings, database, Redis, payments, SMS, email and recent page errors, never secrets).
- **Before opening.** `PRELAUNCH_PASSWORD` puts a password page in front of every page (API routes and webhooks still work), so partners can set up shops before the public sees the site. Remove it to open.

Extra environment variables, on top of the test site's table below (without `TOWNMART_TEST_MODE`, `TEST_SITE_PASSWORD` and `LIVE_PAYMENT_TESTERS`):

| Variable | Value |
|---|---|
| `APP_URL` | the live address, e.g. `https://townmart.com.ng` |
| `DATA_ENCRYPTION_KEY`, `DATA_HASH_KEY` | two different random 32-byte keys |
| `SEED_SUPER_ADMIN_EMAIL`, `SEED_SUPER_ADMIN_PASSWORD` | the first super admin |
| `S3_PUBLIC_BUCKET`, `S3_PRIVATE_BUCKET` | the live site's own buckets |
| `CRON_SECRET`, `HEALTH_KEY` | random strings, 24+ characters |
| `PRELAUNCH_PASSWORD` | optional, until launch |
| `PAYMENT_PROVIDER`, `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_HASH` | `flutterwave` and the live v3 keys; the webhook URL is `https://<live site>/api/webhooks/flutterwave` |
| `BANK_VERIFIER`, `PAYSTACK_SECRET_KEY` | the payout bank check (see `lib/payments/banks.ts`) |
| `SMS_PROVIDER`, `TERMII_*`, `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | as in section 4 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | the live hostname added in Turnstile |
| `GOOGLE_MAPS_API_KEY` | road distances for delivery fees |

### Vercel test site

A staging site people can click through, with no real money, emails or SMS. Vercel builds with `pnpm vercel-build`, which runs `scripts/vercel/prepare.ts` and then `next build`:

1. **Database roles.** With Vercel's Neon integration (`DATABASE_URL` is the owner's pooled connection, `DATABASE_URL_UNPOOLED` its direct one), the build creates `townmart_migrator`, `townmart_app` and `townmart_readonly` and a separate `townmart` database, like `roles.sql`. Their passwords are derived from `AUTH_SECRET`, and at runtime the app connects through the pooler as `townmart_app`, so row-level security still applies (`lib/platform.ts`). Set `DATABASE_ROLES=manual` to give `DATABASE_URL` and `MIGRATE_DATABASE_URL` yourself instead.
2. **Migrations** (`prisma migrate deploy`) as `townmart_migrator`.
3. **Seed.** Reference data always. The demo shops, orders and accounts only with `SEED_DEMO_DATA=true`; otherwise any demo accounts already in the database are suspended and signed out, and their shops hidden (`prisma/seed-accounts.ts`; nothing is deleted, and an admin can restore one from the console). If `SEED_SUPER_ADMIN_EMAIL` names an account that already exists, that account is made super admin once it has confirmed its email; with `SEED_SUPER_ADMIN_PASSWORD` too, a new account is created if there isn't one. The seed is idempotent.

**Background jobs.** On Vercel (`VERCEL=1`), `JOBS_INLINE` defaults to true: each queued job runs in the same function straight after the response, with the worker's handlers (`lib/jobs/inline.ts`). Scheduled jobs (unpaid orders expiring, refunds, escrow, payouts, retention) run when people use the site: a page view asks `/api/jobs/tick` at most once a minute, and each job keeps its own interval from its cron pattern (every N minutes, hourly, or daily). With no visitors, nothing runs. A live site should run the worker instead.

**Test mode** (`TOWNMART_TEST_MODE=true`):

- a banner on every page says no real money moves, and robots are told not to index anything;
- payments use the pretend payment page and bank checks are faked, unless real providers are set;
- emails and SMS go to the test inbox at `/test-inbox` (anyone on the site can read it, so testers should use made-up details). Once both `EMAIL_PROVIDER` and `SMS_PROVIDER` really send, the test inbox closes;
- there is no passwordless or shared sign-in: testers make their own accounts, and admins (including the owner, via `SEED_SUPER_ADMIN_EMAIL`) must turn on two-step sign-in like on the live site;
- Turnstile is skipped if it isn't configured, and `DATA_ENCRYPTION_KEY` and `DATA_HASH_KEY` are derived from `AUTH_SECRET` if not set.

Never set it on the live site.

**Environment variables** (Project Settings → Environment Variables):

| Variable | Value |
|---|---|
| `TOWNMART_TEST_MODE` | `true` |
| `TEST_SITE_PASSWORD` | a password for your testers. Every page asks for it first, so strangers can't use the test site's real email and SMS credit |
| `SEED_SUPER_ADMIN_EMAIL` | your own account's email. Sign up and confirm it first; the next deploy makes it super admin |
| `AUTH_SECRET` | 32 or more random characters |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | set by the Neon integration (leave its prefix empty) |
| `REDIS_URL` (or `KV_URL`) | set by the Redis integration (Upstash) |
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT` | `https://<account id>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | from an R2 API token with Object Read & Write on both buckets |
| `S3_PUBLIC_BASE_URL` | the public bucket's `https://pub-….r2.dev` address |

`APP_URL` defaults to the deployment's own address. The public bucket needs public access turned on (its r2.dev address), and both buckets need the CORS rule from section 3 with the Vercel address as the allowed origin.

**Flutterwave on the test site.** Payments stay on the pretend page until `PAYMENT_PROVIDER=flutterwave` is set. Then add `FLUTTERWAVE_SECRET_KEY` (a v3 **test** key, `FLWSECK_TEST-…`) and `FLUTTERWAVE_WEBHOOK_HASH` (the secret hash typed under Settings → Webhooks, with the URL `https://<site>/api/webhooks/flutterwave` and "Enable v3 webhooks" ticked). With a **live** key (`FLWSECK-…`) a test-mode site runs **gateway tests** only (`lib/payments/gateway-test.ts`): card checkout is refused for everyone except payment testers, listed in `LIVE_PAYMENT_TESTERS` (comma-separated account emails, each verified). A tester is charged `LIVE_TEST_CHARGE_NAIRA` (default 100) whatever the order costs. The payment reference ends in `-GWTEST`, the payment is refunded automatically through Flutterwave, and the order is never marked paid. That tests the payment page, webhook, verify and refund with real money and no real sale. `/api/health` shows `payments`: the provider, whether the key is a test key, whether the webhook hash is set and whether Flutterwave accepts the key (never the keys themselves).

How a payment is trusted: the webhook's `verif-hash` must match (compared in constant time), the event is stored once per Flutterwave transaction, and then the transaction is fetched from Flutterwave's verify API by its id. Its `tx_ref` must be the order's payment reference, its currency NGN and its amount exactly the order total worked out on the server; a wrong amount is refunded and flagged, never accepted. The shopper's return to `/checkout/complete` and the unpaid-order expiry job check the same way, so a missed webhook doesn't lose a payment.
