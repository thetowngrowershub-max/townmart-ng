# Deferred work

What the spec asks for that is **not** in the current build, and the phase that delivers it. Nothing listed here is stubbed in the code.

## From Phase 0 (Foundations)

| Item | Why deferred | Lands in |
|---|---|---|
| Two-factor authentication (SMS or authenticator app) | Phone sign-in and phone verification shipped in Phase 1; a second factor at sign-in belongs with profile and security settings | Done (Phase 6: SMS code to a verified phone) |
| Linking Google to an existing password account from settings | Automatic linking is unsafe; needs an in-account "connect Google" flow | Done (Phase 6) |
| Recording Terms/Privacy acceptance at sign-up | Needs versioned `legal_documents` and `policy_acceptances` | Done (Phase 6) |
| React Email templates | Plain HTML templates behind the `EmailProvider` interface are kept, including the order receipt; switching is cosmetic | Phase 8 |
| Strict CSP with nonces | Basic security headers are set; a nonce-based CSP is easier once third-party scripts (Paystack, Turnstile, analytics) are final | Phase 8 |
| Production `docker-compose.prod.yml`, Caddyfile, PgBouncer | Spec places production setup in Phase 8; the `Dockerfile` already has `web` and `worker` targets | Phase 8 |
| Backups, PITR, restore drills | Phase 8 | Phase 8 |
| Playwright E2E in CI | Spec places E2E in Phase 8. Phase 0 flows were checked in a real browser by hand | Phase 8 |

## From Phase 1 (Sellers, catalogue and search)

| Item | Why deferred | Lands in |
|---|---|---|
| Add to cart, checkout, delivery fees and delivery estimates | Built in Phase 3 | Done |
| Booking a service | Built in Phase 4 | Done |
| Reviews and ratings | Built in Phase 4 | Done |
| Questions and answers on listings | Not built; reviews and order messages cover the launch need | Phase 7 |
| Promotions, coupons and sale scheduling | Built in Phase 2 | Done |
| Staff invitations and management UI | `business_staff` and the staff permission flags are enforced in `authz` and RLS; the invite screens are not built | Phase 7 |
| Category and category-attribute management in the admin console | Categories are seeded; attribute values per category are stored on products but not yet edited in the product form | Phase 7 |
| Listing moderation queue (flag, take down) | Listings of approved sellers go live directly; admins can suspend a seller | Phase 7 |
| Automated KYC with an identity provider (e.g. NIN/BVN check) | Phase 1 uses manual document review behind a `provider` column. Re-deferred in Phase 6: it needs a chosen provider (e.g. Smile ID, Prembly, Dojah), a signed contract and DPA, and a DPIA (a draft is in the compliance centre) | When a KYC provider is contracted |
| Image cropping in the uploader (spec §Catalogue, Phase 1) | Not built. Uploads are compressed to WebP (max 1600 px) and shown centre-fitted; sellers crop before uploading. Flagged in the Phase 1 review | Phase 1 follow-up, if wanted before merge |
| Cleaning up abandoned uploads in `tmp/` | Best handled by an S3 lifecycle rule (expire `tmp/` after 1 day), configured with production storage | Phase 8 |
| Final legal texts (Seller Agreement, DPA, Prohibited Items) | Sellers accept versioned drafts (`2026-10-draft`); final texts need legal review. The versioned `legal_documents` table shipped in Phase 6; see "Final, lawyer-reviewed legal texts" below | Before launch |
| Dedicated search engine (Meilisearch/Typesense) | Postgres full-text plus trigram covers launch scale; callers use the `SearchProvider` interface only | When search load needs it |

## From Phase 2 (Promotions and pricing)

| Item | Why deferred | Lands in |
|---|---|---|
| Entering a coupon code, and recording redemptions | Built in Phase 3 | Done |
| Cart-level promotions shown on listings | Promotions with a minimum order or a coupon apply in the cart, which shows what's needed to qualify; cards and product pages still show automatic deals only | Not planned |
| Admin screens for platform-wide promotions | Schema, RLS and pricing support them; only admin/system scope can write them | Phase 7 |
| Price filter and sort on the discounted price | Search filters and sorts on the listed price; cards show the discounted price | When search moves to a dedicated engine |
| Final Promotions & Coupon Terms | Template at `/legal/promotions`; needs legal review | Before launch |

## From Phase 3 (Cart, checkout and payments)

| Item | Why deferred | Lands in |
|---|---|---|
| Services and bookings in the cart | Built in Phase 4 | Done |
| Seller order management (accept, pack, dispatch, delivered, tracking) | Built in Phase 4 | Done |
| Refunds for payments that can't be applied (wrong amount, duplicate, paid after the stock sold) | Built in Phase 5: refunded automatically through the provider | Done |
| Releasing escrow to sellers and payouts | Built in Phase 5 | Done |
| Reconciling provider clearing against Paystack/Flutterwave settlement reports | The ledger tracks what each provider holds for us (shown on `/admin/payouts`); matching it to the providers' settlement files needs their report formats and live accounts | Phase 8 |
| Per-customer coupon limits for guests | Coupons with a per-customer limit ask the shopper to sign in | Not planned |
| Admin screens for delivery zones, default rates and commission rules | Seeded (6 zones, 4 weight bands each, 5% global commission) and stored in tables; edited in the database for now | Phase 7 |
| Seller screen for its own delivery rates | Built in Phase 4 | Done |
| Notification bell in the header | Built in Phase 4 | Done |
| Wishlist | Built in Phase 4 | Done |
| Final Terms of Use and Refund Policy | Drafts at `/legal/terms` and `/legal/refunds`; their versions are stored on every order; templates since Phase 6 | Before launch |
| Load test for overselling | A database test races 50 buyers for 10 units; a full load test is in the Phase 8 plan | Phase 8 |

## From Phase 4 (Fulfilment, bookings and reviews)

| Item | Why deferred | Lands in |
|---|---|---|
| Refunds when a paid booking is cancelled, or a paid order goes wrong | Built in Phase 5 | Done |
| Customers cancelling or returning goods | Built in Phase 5 | Done |
| Commission on pay-on-delivery orders | Built in Phase 5: taken from the seller's balance once the cash is collected and the hold period ends | Done |
| Releasing escrow after completion | Built in Phase 5 | Done |
| PDF invoices | Sellers print the packing slip page (browser print or save as PDF); customers have the emailed receipt and order page | Phase 8, if wanted |
| Review moderation queue | Reported reviews are marked `reported` and stay visible; hiding is admin/system only, with no admin screen yet | Phase 7 |
| Notification preferences (opt out of SMS or email per type) | All order and booking notices are sent; marketing stays opt-in | Done (Phase 6) |
| Week or month calendar grid for providers | `/dashboard/bookings` is a day-by-day diary with filters, which works on phones | Not planned unless asked |
| Real-time messages | The conversation updates on page load and after sending; the other side is told by email and in-app notice | Phase 8, if wanted |
| Seller replies to a review more than once, or a conversation under it | One public reply, which the seller can edit | Not planned |

## From Phase 5 (Refunds, disputes and payouts)

| Item | Why deferred | Lands in |
|---|---|---|
| Statement PDF file | Statements are a print-friendly page (print or save as PDF from the browser) plus a CSV download | Phase 8, if wanted |
| Payouts through Flutterwave | Payouts use Paystack transfers, the provider seller bank accounts are verified and registered with; card payments through Flutterwave still refund through Flutterwave | When a second payout provider is needed |
| Refunds for pay-on-delivery orders through TownMart | The customer paid the seller in cash, so TownMart can't send money back; disputes can still be opened, and TownMart's decision tells the seller what to do | Not planned |
| Collecting money from a seller whose balance goes negative | A refund after payout can leave a negative available balance; it is netted against later sales before the next payout. Recovering it otherwise (invoice, card on file) is not built | Phase 7 |
| Return shipping labels and pickup booking | The customer and seller agree how the item comes back in messages; the seller chooses what goes back on sale when approving | Not planned |
| Refunds to a store credit or wallet | Every refund goes back to the original payment method | Not planned |
| Admin settings screen for refund deadlines, the late-cancellation share and the payout minimum | Stored as settings (`refunds.seller_response_hours`, `refunds.late_cancel_percent`, `payouts.minimum_naira`) with defaults of 48 hours, 50% and ₦1,000; edited in the database for now | Phase 7 |

## From Phase 6 (Legal, consent and privacy)

| Item | Why deferred | Lands in |
|---|---|---|
| Final, lawyer-reviewed legal texts | All 13 pages are templates marked "Template: review with a Nigerian lawyer/DPO before launch". A lawyer or DPO publishes the final versions from `/admin/compliance/legal`; the template notice goes once a version is published without it | Before launch |
| Company details in the legal pages (legal name, RC number, address, DPO, hosting location) | Not known yet; shown as "[… not set]" until entered on `/admin/compliance/retention` | Before launch |
| Naming the email, SMS and hosting processors | The processor register lists them as "To be confirmed" until providers are chosen | Phase 8 (production setup) |
| Automated KYC with an identity provider | See Phase 1 | When a KYC provider is contracted |
| Sending marketing campaigns | Consent, unsubscribe, suppression and `marketingAudience()` are built; there is no campaign editor or sender | Not planned for launch |
| Removing order records after six years | Orders, payments, refunds and the ledger are kept as the law requires; nothing is old enough to remove yet | When the first records reach six years |
| Two-step sign-in by authenticator app, and recovery codes | SMS codes cover launch; a lost phone is recovered through support, who check identity | Phase 8, if wanted |
| Strict CSP with nonces, covering the consent-gated scripts | Scripts load only after consent; a nonce-based CSP follows once the analytics and marketing tools are chosen | Phase 8 |

## Links that point at later phases

The footer's help and company links point at routes that later phases build (`/about`, `/help`, `/contact`). Until then they show the 404 page. Sidebar items for later phases are shown as "Soon" and are not links.
