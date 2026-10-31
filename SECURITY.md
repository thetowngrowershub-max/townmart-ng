# Security review (OWASP Top 10, 2021)

Phase 8 review of TownMart against the OWASP Top 10. Each section says what protects TownMart, where it lives, how it is tested, and what this review changed. The last section lists what is left.

To report a vulnerability, email security@townmart.ng. Please don't open a public issue.

## A01 Broken access control

- **Two layers on every request.**
  - `lib/authz` checks the role and permission, and the business for seller actions, before any query.
  - Postgres row-level security enforces the same rule underneath. The app connects as `townmart_app`, which owns no tables and can't bypass RLS. `withRls()` sets the user, business and scope for one transaction only.
- **Tests.** `tests/db/*` prove that seller A can't read or write seller B's products, orders, refunds, payouts, staff invitations, questions or reports, at both layers. They also prove customers only see their own data and guests only reach an order through its hashed access token.
- **Admin roles.**
  - Admin pages each need a named permission.
  - Role changes need a super admin, and the last super admin can't be removed.
  - Staff accounts get only the areas their owner ticks.
- **Fields TownMart controls** can't be changed by sellers even with direct SQL, because triggers guard them: take-downs, escrow release, review author names and question visibility.
- **Redirects.** Sign-in `next` is limited to same-site paths (`safeNextPath`). CMS links are limited to TownMart paths or https.

## A02 Cryptographic failures

- **In transit.**
  - HTTPS everywhere through Caddy, with HSTS (2 years, preload).
  - Postgres accepts TCP only over TLS (`pg_hba.prod.conf` rejects plain connections).
  - PgBouncer connects to Postgres with `server_tls_sslmode=require`.
- **At rest.**
  - Passwords are hashed with Argon2id.
  - Phone numbers, street addresses and KYC references use AES-256-GCM column encryption. The key id travels with each ciphertext, and there's a rotation runbook.
  - Lookups use HMAC hashes with a separate key.
  - Backups are encrypted twice over: dumps with age (public key on the server, private key offline) and pgBackRest repositories with AES-256.
  - The server's disks should also be encrypted; see DEPLOYMENT.md.
- **Never stored:** raw BVN or NIN, full bank account numbers, IP addresses (only HMACs) and one-time codes (only hashes).
- **Tests.** `tests/db/schema-conventions.test.ts` fails the build if any `*_encrypted` column or JSON key holds plain text.

## A03 Injection

- **SQL.**
  - Queries go through Prisma or tagged `$queryRaw` templates, which are parameterised. There is no `$queryRawUnsafe` or `$executeRawUnsafe` anywhere.
  - The few `Prisma.raw` fragments in search and promotions are fixed table aliases and column names chosen in code, never user input.
- **HTML.** Seller descriptions, review replies, CMS pages and legal texts are sanitised with DOMPurify on write (`lib/sanitize.ts`) and rendered only from the sanitised copy.
- **CSV.** Exports neutralise formula characters (`lib/csv.ts`).
- **Shell.** The backup scripts take no user input. Database names are checked against a strict pattern before use.

## A04 Insecure design

- **Money.** Totals are integer kobo, priced server-side by the tested `lib/pricing`. Payments are confirmed by the provider's verify API, not by the redirect or the webhook body, and each webhook event is processed once.
- **Stock and bookings.** Stock is reserved under `SELECT … FOR UPDATE`, and bookings are serialised with an exclusion constraint. The load test races 50 buyers for 10 units and checks nothing is oversold.
- **Escrow.** Sellers are paid only after delivery and the return window. Refunds after payout are netted against later sales.
- **Abuse limits.** Redis rate limits cover sign-in, codes, checkout, search, coupons, reviews, reports, questions, uploads, payouts, data requests and invitations. Turnstile protects sign-up and the public forms.

## A05 Security misconfiguration

- **Content-Security-Policy with a fresh nonce on every page** (new in Phase 8, `middleware.ts`, `lib/security/csp.ts`).
  - Scripts need the nonce, plus `'strict-dynamic'` for what they load: Turnstile, and analytics only after consent.
  - The policy also sets `object-src 'none'`, `frame-ancestors 'none'` and `base-uri 'self'`.
  - `form-action` allows the site itself and the Paystack and Flutterwave checkout pages only.
  - `connect-src` allows the configured storage endpoint only.
  - API responses get `default-src 'none'`.
  - Unit tests cover the policy.
- **Other headers:** `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, a restrictive `Permissions-Policy`, and no `X-Powered-By`.
- **Production refuses development drivers.** The app won't start with local file storage, console SMS, or fake payments or bank checks.
- **Network.**
  - Only Caddy publishes ports.
  - Postgres, PgBouncer, Redis and MinIO are reachable only on the private Docker network.
  - Redis needs a password.
  - The CI smoke test checks that nothing else listens on the host.
- **Secrets.** All secrets come from the environment, and nothing secret is committed. The app containers get blanked superuser and migrator passwords, so a compromised app process can't use them (new in Phase 8).
- **Least-privilege database roles:** `townmart_migrator` owns the schema and runs migrations, `townmart_app` serves requests, and `townmart_readonly` serves reporting.

## A06 Vulnerable and outdated components

- `pnpm audit --prod` reported five advisories: four in the PostCSS copy that Next.js uses at build time, and one in `deepmerge-ts` inside Prisma's config loader. Neither handles user input at runtime, but both are pinned to fixed versions through `pnpm.overrides`. The audit now reports none.
- Dependencies are installed from the lockfile (`--frozen-lockfile`) in CI and in Docker builds. Base images are pinned (Node 22.20, Postgres 16, Caddy 2.10, Redis 7, a dated MinIO release).
- **Known peer warning:** `next-auth` 5 beta lists nodemailer 7 or 8 as a peer, and TownMart uses 10. Auth.js's email provider isn't used; TownMart sends its own emails. The warning is harmless until Auth.js 5 ships stable.

## A07 Identification and authentication failures

- **Sessions** are database sessions (revocable). Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- **Sign-out everywhere.** A password reset, a suspension, a role removal and "sign out everywhere" each delete all of that person's sessions.
- **Lockout.** Five failed passwords lock the account for 15 minutes, on top of per-IP and per-email rate limits.
- **Two-step sign-in** is optional, with an SMS code to a verified phone.
- **Google accounts** link to an existing account only from inside that account, never automatically by email.

## A08 Software and data integrity failures

- Payment webhooks are checked by provider signature (Paystack HMAC-SHA512, Flutterwave secret hash), stored once by (provider, event id), and acted on only after the verify API agrees.
- Server Actions carry Next.js's built-in origin check against CSRF. The two POST route handlers are a webhook (signed) and one-click unsubscribe (HMAC-signed link).
- Migrations are forward-only, reviewed in PRs, and run in CI against a fresh database. A drift check compares the schema with the migrations.

## A09 Security logging and monitoring failures

- **Audit log.** Every staff and seller change is written to `audit_logs`, which is append-only even for the database owner, with redacted before and after values. Admin views of personal data are logged too.
- **Logs.** pino writes structured logs with redaction, and failed health checks and bad webhook signatures are logged as warnings.
- **`/admin/system`** shows:
  - failed jobs, with retry;
  - the slowest queries (`pg_stat_statements`, loaded in production);
  - long-running queries;
  - the last backup and restore drill.
- **Docker logs** rotate (5 × 20 MB per service).

## A10 Server-side request forgery

- The server fetches only fixed hosts: the Paystack, Flutterwave, Termii, Resend and Turnstile APIs, and the configured S3 endpoint. No URL from a user or seller is ever fetched by the server.
- Image uploads go straight from the browser to storage with presigned URLs. The server then reads the object by its key, checks the type, size and pixel count, re-encodes it to WebP and strips EXIF data.

## Left to do before launch

- **Penetration test.** Commission an external test against the staging site before launch.
- **Inline styles.** `style-src` still allows `'unsafe-inline'`, because React and Next.js set style attributes. Script injection is what the policy blocks.
- **DNS and Cloudflare.** If Cloudflare proxies the site, add its IP ranges to `trusted_proxies` in the Caddyfile, so rate limits see visitors' real IPs.
- **Monitoring alerts.** Add uptime and disk-usage alerts in your hosting provider's monitoring. The app exposes `/api/health`. Point an error tracker at the pino logs (the code is Sentry-ready).
