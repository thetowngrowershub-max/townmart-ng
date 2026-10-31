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
| `SMS_PROVIDER`, `TERMII_API_KEY`, `TERMII_SENDER_ID` | `termii` and the approved sender ID |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | `resend`, the key, and an address on a domain verified in Resend (SPF, DKIM, DMARC) |
| `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | from Cloudflare Turnstile |
| `S3_*` | your storage endpoint, keys and buckets; `S3_PUBLIC_BASE_URL` is the public bucket's URL |
| `SEED_ADMIN_PASSWORD`, `SEED_SUPER_ADMIN_PASSWORD` | strong passwords for the first staff accounts; change them after signing in |
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
docker compose run --rm migrate pnpm db:seed    # reference data and staff accounts, first time only
docker compose up -d --wait web worker caddy backup
```

Then check:

1. `https://townmart.ng/api/health` answers `{"status":"ok",…}` and the home page loads with a padlock.
2. Sign in as `superadmin@townmart.local` with `SEED_SUPER_ADMIN_PASSWORD`, change the password, and turn on two-step sign-in.
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

- Use Postgres 16 with `pg_stat_statements`, and run `sql/bootstrap/roles.sql` (or `pnpm db:bootstrap`) as the database superuser to create the three roles before the first migration.
- Point `DATABASE_URL` at the provider's pooler in **transaction mode** with `?pgbouncer=true`, and `MIGRATE_DATABASE_URL` at a direct connection as `townmart_migrator`. TownMart is safe behind a transaction pooler: all advisory locks are transaction-scoped, and RLS settings are set per transaction.
- Run `pnpm worker` as a separate always-on process (a background worker or a small VM); serverless functions can't run it.
- Backups then come from the provider's PITR. Still run `scripts/db/backup.sh` and `verify-restore.sh` from a scheduled job elsewhere, so you have a copy outside the provider and proof that it restores.
