# Deferred work

What the spec asks for that is **not** in the current build, and the phase that delivers it. Nothing listed here is stubbed in the code.

## From Phase 0 (Foundations)

| Item | Why deferred | Lands in |
|---|---|---|
| Two-factor authentication (SMS or authenticator app) | Phone sign-in and phone verification shipped in Phase 1; a second factor at sign-in belongs with profile and security settings | Phase 6 |
| Linking Google to an existing password account from settings | Automatic linking is unsafe; needs an in-account "connect Google" flow | Phase 6 (Profile & security) |
| Recording Terms/Privacy acceptance at sign-up | Needs versioned `legal_documents` and `policy_acceptances` | Phase 6 |
| React Email templates | Plain HTML templates behind the `EmailProvider` interface are kept, including the order receipt; switching is cosmetic | Phase 8 |
| Strict CSP with nonces | Basic security headers are set; a nonce-based CSP is easier once third-party scripts (Paystack, Turnstile, analytics) are final | Phase 8 |
| Production `docker-compose.prod.yml`, Caddyfile, PgBouncer | Spec places production setup in Phase 8; the `Dockerfile` already has `web` and `worker` targets | Phase 8 |
| Backups, PITR, restore drills | Phase 8 | Phase 8 |
| Playwright E2E in CI | Spec places E2E in Phase 8. Phase 0 flows were checked in a real browser by hand | Phase 8 |

## From Phase 1 (Sellers, catalogue and search)

| Item | Why deferred | Lands in |
|---|---|---|
| Add to cart, checkout, delivery fees and delivery estimates | Built in Phase 3 | Done |
| Booking a service | Service pages show availability; booking needs the bookings engine | Phase 4 |
| Reviews, ratings and Q&A | Rating columns exist (and only TownMart can write them); the review flow needs completed orders and bookings | Phase 4 |
| Promotions, coupons and sale scheduling | Built in Phase 2 | Done |
| Staff invitations and management UI | `business_staff` and the staff permission flags are enforced in `authz` and RLS; the invite screens are not built | Phase 7 |
| Category and category-attribute management in the admin console | Categories are seeded; attribute values per category are stored on products but not yet edited in the product form | Phase 7 |
| Listing moderation queue (flag, take down) | Listings of approved sellers go live directly; admins can suspend a seller | Phase 7 |
| Automated KYC with an identity provider (e.g. NIN/BVN check) | Phase 1 uses manual document review behind a `provider` column | Phase 6 |
| Image cropping in the uploader (spec §Catalogue, Phase 1) | Not built. Uploads are compressed to WebP (max 1600 px) and shown centre-fitted; sellers crop before uploading. Flagged in the Phase 1 review | Phase 1 follow-up, if wanted before merge |
| Cleaning up abandoned uploads in `tmp/` | Best handled by an S3 lifecycle rule (expire `tmp/` after 1 day), configured with production storage | Phase 8 |
| Final legal texts (Seller Agreement, DPA, Prohibited Items) | Sellers accept versioned drafts (`2026-10-draft`); final texts need legal review and the versioned `legal_documents` table | Phase 6 |
| Dedicated search engine (Meilisearch/Typesense) | Postgres full-text plus trigram covers launch scale; callers use the `SearchProvider` interface only | When search load needs it |

## From Phase 2 (Promotions and pricing)

| Item | Why deferred | Lands in |
|---|---|---|
| Entering a coupon code, and recording redemptions | Built in Phase 3 | Done |
| Cart-level promotions shown on listings | Promotions with a minimum order or a coupon apply in the cart, which shows what's needed to qualify; cards and product pages still show automatic deals only | Not planned |
| Admin screens for platform-wide promotions | Schema, RLS and pricing support them; only admin/system scope can write them | Phase 7 |
| Price filter and sort on the discounted price | Search filters and sorts on the listed price; cards show the discounted price | When search moves to a dedicated engine |
| Final Promotions & Coupon Terms | Draft at `/legal/promotions`; needs legal review | Phase 6 |

## From Phase 3 (Cart, checkout and payments)

| Item | Why deferred | Lands in |
|---|---|---|
| Services and bookings in the cart | The cart and orders take products only; booking a service needs the bookings engine (capacity, exclusion constraint) | Phase 4 |
| Seller order management (accept, pack, dispatch, delivered, tracking) | Sellers see recent orders on the dashboard; status changes beyond payment are Phase 4 | Phase 4 |
| Refunds for payments that can't be applied (wrong amount, duplicate, paid after the stock sold) | Detected and logged as needing attention; the order is never marked paid. Provider refunds and ledger reversals arrive with refunds | Phase 5 |
| Releasing escrow to sellers and payouts | Seller nets are held in escrow accounts in the ledger | Phase 5 |
| Settling provider clearing against payouts from Paystack/Flutterwave | Needs settlement reports from the providers | Phase 5 |
| Per-customer coupon limits for guests | Coupons with a per-customer limit ask the shopper to sign in | Not planned |
| Admin screens for delivery zones, default rates and commission rules | Seeded (6 zones, 4 weight bands each, 5% global commission) and stored in tables; edited in the database for now | Phase 7 |
| Seller screen for its own delivery rates | Schema and RLS allow a seller to set rates per zone; the form isn't built, so sellers use TownMart's defaults | Phase 4 |
| Notification bell in the header | Notifications are listed at `/account/notifications` | Phase 4 |
| Wishlist | Not in the Phase 3 scope; moved in the sidebar | Phase 4 |
| Final Terms of Use and Refund Policy | Drafts at `/legal/terms` and `/legal/refunds`; their versions are stored on every order | Phase 6 |
| Load test for overselling | A database test races 50 buyers for 10 units; a full load test is in the Phase 8 plan | Phase 8 |

## Links that point at later phases

The footer's help and company links point at routes that later phases build (`/about`, `/help`, `/contact`). Until then they show the 404 page. Sidebar items for later phases are shown as "Soon" and are not links.
