# Deferred work

What the spec asks for that is **not** in the current build, and the phase that delivers it. Nothing listed here is stubbed in the code.

## From Phase 0 (Foundations)

| Item | Why deferred | Lands in |
|---|---|---|
| Phone OTP sign-in and 2FA (Termii `SmsProvider`) | `otp_codes` table exists; the flow needs the SMS provider and phone capture | Phase 1 (with seller onboarding, which needs phone verification) |
| Linking Google to an existing password account from settings | Automatic linking is unsafe; needs an in-account "connect Google" flow | Phase 6 (Profile & security) |
| Recording Terms/Privacy acceptance at sign-up | Needs versioned `legal_documents` and `policy_acceptances` | Phase 6 |
| React Email templates | Phase 0 uses plain HTML templates behind the same `EmailProvider` interface | Phase 3 (order notifications) |
| Strict CSP with nonces | Basic security headers are set; a nonce-based CSP is easier once third-party scripts (Paystack, Turnstile, analytics) are final | Phase 8 |
| Production `docker-compose.prod.yml`, Caddyfile, PgBouncer | Spec places production setup in Phase 8; the `Dockerfile` already has `web` and `worker` targets | Phase 8 |
| Backups, PITR, restore drills | Phase 8 | Phase 8 |
| Playwright E2E in CI | Spec places E2E in Phase 8. Phase 0 flows were checked in a real browser by hand | Phase 8 |
| `StorageProvider` (S3/MinIO) code | Buckets are created by Docker Compose; the first uploads are product images | Phase 1 |
| `SearchProvider` and storefront search | `/search` arrives with the catalogue | Phase 1 |

## Links that point at later phases

The header search box, category tiles, cart icon, "Sell on TownMart" and the footer's legal and help links point at routes that later phases build (`/search`, `/c/*`, `/cart`, `/sell`, `/legal/*`, `/about`, `/help`, `/contact`). Until then they show the 404 page. Sidebar items for later phases are shown as "Soon" and are not links.
