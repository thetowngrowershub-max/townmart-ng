# Deferred work

What the spec asks for that is **not** in the current build, and the phase that delivers it. Nothing listed here is stubbed in the code.

## From Phase 0 (Foundations)

| Item | Why deferred | Lands in |
|---|---|---|
| Two-factor authentication (SMS or authenticator app) | Phone sign-in and phone verification shipped in Phase 1; a second factor at sign-in belongs with profile and security settings | Phase 6 |
| Linking Google to an existing password account from settings | Automatic linking is unsafe; needs an in-account "connect Google" flow | Phase 6 (Profile & security) |
| Recording Terms/Privacy acceptance at sign-up | Needs versioned `legal_documents` and `policy_acceptances` | Phase 6 |
| React Email templates | Phase 0 uses plain HTML templates behind the same `EmailProvider` interface | Phase 3 (order notifications) |
| Strict CSP with nonces | Basic security headers are set; a nonce-based CSP is easier once third-party scripts (Paystack, Turnstile, analytics) are final | Phase 8 |
| Production `docker-compose.prod.yml`, Caddyfile, PgBouncer | Spec places production setup in Phase 8; the `Dockerfile` already has `web` and `worker` targets | Phase 8 |
| Backups, PITR, restore drills | Phase 8 | Phase 8 |
| Playwright E2E in CI | Spec places E2E in Phase 8. Phase 0 flows were checked in a real browser by hand | Phase 8 |

## From Phase 1 (Sellers, catalogue and search)

| Item | Why deferred | Lands in |
|---|---|---|
| Add to cart, checkout, delivery fees and delivery estimates | Product pages say ordering arrives next; needs cart, orders and Paystack payments | Phase 3 |
| Booking a service | Service pages show availability; booking needs the bookings engine | Phase 4 |
| Reviews, ratings and Q&A | Rating columns exist (and only TownMart can write them); the review flow needs completed orders and bookings | Phase 4 |
| Promotions, coupons and sale scheduling | Compare-at prices work now; scheduled promotions are their own feature | Phase 2 |
| Staff invitations and management UI | `business_staff` and the staff permission flags are enforced in `authz` and RLS; the invite screens are not built | Phase 7 |
| Category and category-attribute management in the admin console | Categories are seeded; attribute values per category are stored on products but not yet edited in the product form | Phase 7 |
| Listing moderation queue (flag, take down) | Listings of approved sellers go live directly; admins can suspend a seller | Phase 7 |
| Automated KYC with an identity provider (e.g. NIN/BVN check) | Phase 1 uses manual document review behind a `provider` column | Phase 6 |
| Image cropping in the uploader (spec §Catalogue, Phase 1) | Not built. Uploads are compressed to WebP (max 1600 px) and shown centre-fitted; sellers crop before uploading. Flagged in the Phase 1 review | Phase 1 follow-up, if wanted before merge |
| Cleaning up abandoned uploads in `tmp/` | Best handled by an S3 lifecycle rule (expire `tmp/` after 1 day), configured with production storage | Phase 8 |
| Final legal texts (Seller Agreement, DPA, Prohibited Items) | Sellers accept versioned drafts (`2026-10-draft`); final texts need legal review and the versioned `legal_documents` table | Phase 6 |
| Dedicated search engine (Meilisearch/Typesense) | Postgres full-text plus trigram covers launch scale; callers use the `SearchProvider` interface only | When search load needs it |

## Links that point at later phases

The cart icon and the footer's help and company links point at routes that later phases build (`/cart`, `/about`, `/help`, `/contact`). Until then they show the 404 page. Sidebar items for later phases are shown as "Soon" and are not links.
