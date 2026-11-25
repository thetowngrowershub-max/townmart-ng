# TownMart — Build Prompt for Claude Code

> How to use: save this file as `TOWNMART_BUILD_PROMPT.md` in an empty project folder, open Claude Code there, and say:
> **"Read TOWNMART_BUILD_PROMPT.md and build TownMart phase by phase. Start with Phase 0 and stop for my review at the end of each phase."**

---

## 1. Role & Mission

You are a senior full-stack engineer, database architect and product designer. Build **TownMart**, a production-grade, multi-vendor, multi-page e-commerce web app for Nigeria. TownMart hosts **products** (from retailers, supermarkets, vendors, merchants and producers) and **services** (from service providers and artisans) in one marketplace, with:

- a public storefront for customers,
- a **Merchant / Service Provider dashboard**,
- a **TownMart Admin console**,
- **its own independent, self-owned database and backend** (no Backend-as-a-Service lock-in),
- full ordering, checkout, payments, refunds, and legal/compliance pages aligned with the **Nigeria Data Protection Act (NDPA) 2023** and the **NDPC General Application and Implementation Directive (GAID) 2025**, plus the **Federal Competition and Consumer Protection Act (FCCPA) 2018**.

Work in phases (Section 13). Before writing code in each phase, state your plan in a short checklist. After each phase, run lint, type-check and tests, then summarise what was built and what's next. Never leave TODO stubs in shipped features; if something is deferred, list it in `DEFERRED.md`.

---

## 2. Tech Stack (use exactly this unless you flag a strong reason)

### 2.1 Application
- **Framework:** Next.js 15 (App Router) + TypeScript (strict mode)
- **Styling/UI:** Tailwind CSS + shadcn/ui + lucide-react icons; Framer Motion for subtle transitions only
- **Validation:** Zod (shared schemas for client + server)
- **Forms:** React Hook Form + Zod resolver
- **Server state:** TanStack Query on the client; Server Components + Server Actions / route handlers on the server

### 2.2 Independent Data Layer (TownMart owns all of it)
- **Database:** **PostgreSQL 16**, self-hosted, run via Docker. TownMart is the sole owner of the database server, data, backups and encryption keys. No Supabase, Firebase or other BaaS.
- **ORM & migrations:** **Prisma** (schema in `prisma/schema.prisma`, versioned migrations via `prisma migrate`, typed client). Use raw SQL migrations alongside Prisma for things Prisma can't express: full-text search indexes, triggers, check constraints, partial indexes, `pgcrypto`, and row-level security policies.
- **Cache / queues / locks:** **Redis 7** for sessions cache, rate limiting, stock-reservation locks, idempotency keys, and job queues (**BullMQ**).
- **Background worker:** a separate Node worker process (`/worker`) that runs BullMQ jobs: emails/SMS, webhook processing, data exports, retention/purge jobs, escrow release, low-stock alerts, booking reminders.
- **File / image storage:** **S3-compatible object storage** behind a `StorageProvider` interface. **MinIO** in local/dev (Docker). In production, choose any S3-compatible store: MinIO on our own server, or a provider in Nigeria where possible, with Cloudflare R2 or AWS S3 as fallbacks. Private bucket for KYC documents and data exports (signed URLs, short expiry); public-read bucket for product images served through `next/image`.
- **Authentication:** **Auth.js (NextAuth v5)** with the Prisma adapter, so users, sessions and accounts live in **our** database. Methods: email + password (Argon2id hashing), phone OTP, Google OAuth. Database sessions (not long-lived JWTs) so sessions can be revoked.
- **Search:** Postgres full-text search (`tsvector` + GIN index) with `pg_trgm` for fuzzy matching; design behind a `SearchProvider` interface so Meilisearch/Typesense can be plugged in later.

### 2.3 External services (abstracted, swappable)
- **Payments:** **Paystack** (primary) and **Flutterwave** (secondary) behind a common `PaymentProvider` interface; use subaccounts/split payments for vendor payouts
- **Email:** Resend (React Email templates) behind `EmailProvider`
- **SMS / OTP:** Termii behind `SmsProvider`
- **Bot protection:** Cloudflare Turnstile

### 2.4 Infrastructure & deployment
- `docker-compose.yml` for local development: `postgres`, `redis`, `minio`, `mailpit` (local email inbox), `app`, `worker`
- `docker-compose.prod.yml` + `Dockerfile` (multi-stage) for production on a VPS / dedicated server, with **Caddy or Nginx** as reverse proxy (automatic HTTPS)
- Hosting the database in a **Nigerian data centre** (e.g. Lagos-based providers) is preferred to reduce cross-border transfer obligations under the NDPA; the app must work identically wherever it is deployed (all config via env vars)
- Optional: app on Vercel while the DB/Redis/MinIO stay on our own server, connected over TLS through a connection pooler (**PgBouncer**)
- CI: GitHub Actions — lint, type-check, unit tests, migration check against a throwaway Postgres container, Playwright E2E

**Money:** store all amounts as **integer kobo (BigInt)**; format as `₦12,500.00`.
**Locale/time:** `en-NG`; store timestamps as `timestamptz` (UTC); display in `Africa/Lagos`.

Use environment variables for every key and connection string; create `.env.example` with all required variables and comments. Never hard-code secrets.

---

## 3. User Roles & Permissions

| Role | Description |
|---|---|
| **Guest** | Browse, search, view products/services, add to cart |
| **Customer** | Account, checkout, orders, bookings, reviews, wishlist, refund requests, privacy controls |
| **Merchant** | Sells physical products (sub-types: Retailer, Supermarket, Vendor, Merchant, Producer) |
| **Service Provider** | Sells services/bookings (sub-types: Service Provider, Artisan) |
| **Merchant Staff** | Invited by a merchant with limited permissions (inventory only, orders only, etc.) |
| **Admin** | TownMart operations: approvals, disputes, payouts, content, compliance |
| **Super Admin** | Everything, including role management and audit log access |

A single business account can sell **both** products and services.

**Authorisation is enforced in two layers:**
1. **Application layer:** a central policy module (`lib/authz`) with functions like `can(user, 'order.read', order)`. Every Server Action and route handler calls it; no direct DB access from components.
2. **Database layer (defence in depth):** Postgres **Row-Level Security** on tenant-scoped tables (`products`, `services`, `seller_orders`, `order_items`, `bookings`, `payouts`, etc.). The app sets `SET LOCAL app.current_user_id` and `app.current_business_id` inside each transaction; RLS policies read those settings. The app connects as a non-superuser role (`townmart_app`) that cannot bypass RLS; migrations run as a separate `townmart_migrator` role.

Write automated tests proving a seller cannot read or modify another seller's data at both layers.

---

## 4. Brand & Design System

- **Feel:** modern, clean, trustworthy, neighbourly. "Everything your town sells, in one place."
- **Palette (define as CSS variables / Tailwind tokens, light + dark mode):**
  - Primary: deep green `#0F6B3E`
  - Accent: warm amber `#F5A524` (promotions, CTAs)
  - Neutrals: slate scale; background `#FAFAF7`
  - Semantic: success, warning, danger, info
- **Typography:** "Plus Jakarta Sans" (headings) + "Inter" (body), via `next/font`
- **Components:** rounded-2xl cards, soft shadows, generous whitespace, 8px spacing grid
- **Mobile-first:** target Lighthouse ≥ 90 on mobile for performance, accessibility, best practices, SEO. Skeleton loaders, lazy loading, optimistic UI; works on slow 3G.
- **Accessibility:** WCAG 2.2 AA — keyboard navigation, focus states, alt text required on uploads, contrast checked.
- Build a `/design-system` page (admin-only) showcasing all tokens and components.

---

## 5. Site Map (Multi-Page)

### 5.1 Public Storefront
- `/` — Home: hero search, category tiles (Groceries, Fashion, Electronics, Home, Farm Produce, Beauty, Services, Artisans), flash deals, featured stores, nearby providers, trending products
- `/search` — unified search across products, services, stores; filters (category, price range, rating, state/LGA, delivery option, in-stock, on promotion); sort
- `/c/[category]` and `/c/[category]/[subcategory]` — category listing pages
- `/p/[slug]` — product detail: image gallery (zoom), variants, price with promo badge and strikethrough, stock status, seller card, delivery estimate, reviews, Q&A, related items
- `/s/[slug]` — service detail: description, packages/pricing tiers, availability calendar, service area, portfolio, reviews, "Book now"
- `/store/[storeSlug]` — storefront per merchant/provider: banner, logo, about, products, services, ratings, policies
- `/deals` — all active promotions
- `/cart` — cart grouped **by seller**, with subtotal and delivery per seller
- `/checkout` — multi-step: address → delivery method per seller → booking slot (services) → review → payment
- `/checkout/success` and `/checkout/failed`
- `/sell` — "Sell on TownMart" landing page
- `/about`, `/contact`, `/help` (FAQ + help centre), `/blog` (optional)

### 5.2 Customer Account (`/account/*`)
Dashboard, Orders (list + detail with tracking timeline), Bookings, Addresses, Wishlist, Reviews, Refund/Return requests, Notifications, Payment history, **Privacy Centre** (`/account/privacy`, see Section 9), Profile & security (password, 2FA via OTP, active sessions with "sign out everywhere").

### 5.3 Auth
`/auth/sign-in`, `/auth/sign-up`, `/auth/verify`, `/auth/forgot-password`; seller onboarding at `/sell/onboarding`.

### 5.4 Merchant / Service Provider Dashboard (`/dashboard/*`) — Section 6
### 5.5 Admin Console (`/admin/*`) — Section 7
### 5.6 Legal & Compliance Pages (`/legal/*`) — Section 9

---

## 6. Merchant & Service Provider Dashboard

### 6.1 Onboarding & KYC
- Business type (Retailer, Supermarket, Vendor, Merchant, Producer, Service Provider, Artisan)
- Business details: name, CAC number (optional for individuals/artisans), address, state, LGA, phone, email
- Identity verification via the payment provider's or a KYC provider's API — **do not store raw BVN/NIN**; store verification status + provider reference only. Uploaded ID documents go to the **private** bucket, encrypted, access-logged.
- Bank account for payouts (verified via Paystack "resolve account") → create Paystack subaccount
- Store branding: logo, banner, slug, description
- Accept **Seller Agreement** and **Data Processing Agreement** (versioned; store version + timestamp)
- Status: `pending → under_review → approved / rejected (with reason)`

### 6.2 Overview
KPI cards (today's sales, pending orders, low-stock items, upcoming bookings, payout balance, rating), sales chart (7/30/90 days), top products, recent orders.

### 6.3 Products (inventory)
- **Add / edit product:** title, rich-text description (sanitised), category + subcategory, brand, tags
- **Images:** drag-and-drop multi-upload (up to 8), reorder, set cover, crop, client-side compression (max 1600px, WebP), server-side re-encode to strip EXIF/GPS, alt text required. Upload directly to object storage via **presigned URLs**.
- **Price** (₦), optional **compare-at price**, cost price (private)
- **Stock quantity**, SKU, barcode, low-stock threshold, track-inventory toggle, allow-backorder toggle
- **Variants:** options (Size, Colour, Weight) → variant matrix, each with own price, stock, SKU, image
- Unit of measure (kg, crate, bag, piece, litre, pack) with min order quantity and fractional quantities where allowed
- Weight + dimensions (for delivery fees); perishable flag + shelf-life note
- Status: draft / active / archived; SEO slug, meta title, meta description
- **Bulk tools:** CSV import/export (template + row-level validation report, processed as a background job), bulk price/stock/status edit
- **Stock movements log:** every change recorded (sale, reservation, release, refund restock, manual adjustment with reason)
- Low-stock alerts (in-app + email)

### 6.4 Services
- Title, description, category, portfolio images
- Pricing models: fixed, starting-from, hourly, or packages (Basic/Standard/Premium)
- Duration, service area (LGAs or radius), on-site vs. at-provider-location
- Availability: weekly schedule, blackout dates, slot length, buffer time, max bookings per slot
- Deposit option (% upfront); provider confirmation toggle or auto-confirm
- Double-booking prevented at the database level (exclusion constraint on time ranges per provider)

### 6.5 Promotions
- **Type:** percentage off **or** fixed amount (₦) off
- **Scope:** single product, selected products, category within store, whole store, or service
- Start/end date-time, usage limit, per-customer limit, minimum order value, optional coupon code, flash-deal flag
- Price engine: never below ₦0; apply **single best discount** (no stacking unless coupon allows); show strikethrough + savings badge
- Promotion performance view

### 6.6 Orders & Bookings
- Order status: `pending_payment → paid → processing → ready_for_pickup / shipped → delivered → completed` (+ `cancelled`, `refund_requested`, `refunded`, `partially_refunded`)
- Booking status: `requested → confirmed → in_progress → completed` (+ `cancelled`, `no_show`, `rescheduled`)
- Every status change written to an `*_status_history` table
- Packing slip / invoice PDF; respond to refund/return requests

### 6.7 Payouts & Finance
Balance (pending vs. available), payout history, commission breakdown, statements (CSV/PDF). Escrow: funds released N days after delivery (admin-configurable, default 3). All money movements recorded in a **double-entry ledger** (Section 10.3).

### 6.8 Other
Reviews (reply), per-order messaging, store settings & policies, staff management with permissions, notifications.

---

## 7. Admin Console

- Dashboard: GMV, orders, active sellers, new customers, refund rate, top categories
- Seller approvals & KYC queue; product/service moderation; prohibited-items list
- Category & attribute management
- Orders/bookings oversight; **dispute resolution** workspace
- Refunds (approve/override, trigger provider refund); payouts; commission settings (global / category / seller)
- Delivery zones & fee rules (state/LGA, weight bands, flat rates, free-delivery thresholds)
- CMS: homepage banners, featured stores, FAQ, blog, legal page versions
- **Compliance centre:** DSR queue with SLA timers, consent logs, breach incident register, DPIA records, Record of Processing Activities (RoPA), data processors list
- **Database & system health page:** DB size, connection count, slow queries, last successful backup time, last restore test, queue depths, failed jobs (with retry)
- Users & roles; **immutable audit log**

---

## 8. Ordering, Checkout, Payments, Delivery

### 8.1 Cart
Persistent cart (guest cart keyed by signed cookie → merged on sign-in), grouped by seller, stock re-validated on load and at payment, saved-for-later.

### 8.2 Checkout
- Steps: Address (36 states + FCT, LGA dropdowns from a seeded reference table) → Delivery method per seller → Booking slot → Review → Pay
- Guest checkout (email + phone) with optional account creation after
- Coupon; itemised totals (subtotal, discounts, delivery, service fee, VAT where applicable, grand total)
- **Explicit checkbox** accepting Terms of Use and Refund Policy, versions stored on the order
- Separate, unticked, optional marketing-consent checkbox

### 8.3 Payments
- Paystack (cards, transfer, USSD, supported wallets) and Flutterwave fallback; **Pay on Delivery** toggle per seller (admin can disable globally)
- **Never trust the client:** order created server-side in a DB transaction with locked prices; payment confirmed only via **server-side verification + signed webhooks** (signature check, idempotency keys stored in DB, duplicate deliveries ignored)
- **Stock reservation:** 15-minute hold using a `stock_reservations` table + `SELECT ... FOR UPDATE`; expired holds released by a worker job
- Never store card data
- Split settlement to seller subaccounts; escrow via ledger + transfers

### 8.4 Notifications
Email + SMS + in-app for all order/booking/refund events, booking reminders (24h and 1h), seller alerts. Sent via the worker queue with retries. Marketing only with consent.

### 8.5 Reviews
Verified buyers only; 1–5 stars, text, photos; moderation for reported reviews.

---

## 9. Legal, Policy & NDPA 2023 / GAID 2025 Compliance

> Store all legal pages as **editable, versioned content** in the database (`legal_documents`), with effective dates and "Last updated". Mark generated text: _"Template — review with a Nigerian lawyer/DPO before launch."_ Plain English.

### 9.1 Required Pages (`/legal/*`)
1. **Privacy Policy** — controller identity and contact; DPO contact; data collected (customers, sellers, staff, visitors); purposes and lawful basis for each; recipients (sellers, payment providers, delivery partners, email/SMS providers, hosting); **where the database is hosted** and any cross-border transfers + safeguards; retention periods; data subject rights and how to exercise them; withdrawal of consent; right to complain to the **NDPC**; cookies; children (18+, parental consent for under-18s); security; how changes are communicated
2. **Cookie Policy** + consent banner
3. **Terms of Use**
4. **Seller Agreement / Merchant Terms**
5. **Service Provider & Artisan Terms**
6. **Refund & Returns Policy** (FCCPA-aligned): 7-day return window for goods by default; perishables reported within 24 hours with photo evidence; non-returnable categories listed; refund to original payment method, initiated within 48 hours of approval; service cancellation rules (full refund 24h+ before; partial/none after; provider no-show = full refund); escalation to TownMart then the FCCPC
7. **Shipping & Delivery Policy**
8. **Promotions & Coupon Terms**
9. **Prohibited Items Policy**
10. **Data Processing Agreement** (sellers and third-party processors)
11. **Data Subject Request page** (`/legal/data-request`) for non-account holders
12. **Acceptable Use**, **Accessibility Statement**, **Company Information** (registered name, RC number, address, support contacts)

Footer links to all of the above.

### 9.2 Consent & Cookies
- Banner: **Accept all / Reject non-essential / Customise**, equal prominence. Categories: necessary, functional, analytics, marketing.
- No analytics/marketing scripts before consent.
- Consent records in DB: user or anonymous ID, categories, policy version, timestamp, hashed IP, user agent. Changeable via footer "Cookie settings".
- Marketing opt-in separate from terms; one-click unsubscribe.

### 9.3 Data Subject Rights (Privacy Centre)
- **Access / download** (JSON + PDF, generated by worker, signed link expires in 7 days)
- **Rectify** profile data
- **Delete account** (14-day grace, then anonymise; retain legally required order/financial records and explain this)
- **Withdraw consent**; **object / restrict processing**; **portability** (machine-readable export)
- All requests in admin queue with status and deadline timer; requester notified on completion

### 9.4 Security & Breach Readiness
- HTTPS/HSTS; Postgres connections over TLS only; DB port never exposed publicly (private network / firewall)
- **Encryption at rest:** encrypted disk/volume for Postgres and object storage; **column-level encryption** (AES-256-GCM at the app layer, key from env/KMS) for phone numbers, addresses, KYC references; deterministic hash columns for lookups (e.g. `phone_hash`)
- Least-privilege DB roles (`townmart_app`, `townmart_migrator`, `townmart_readonly` for analytics); RLS as defence in depth
- Rate limiting (Redis) on auth, OTP, checkout, search, DSR forms; Turnstile on sign-up, contact and DSR forms
- Argon2id passwords, optional 2FA, session revocation, lockout after repeated failures
- DOMPurify for rich text, strict CSP, secure cookies, CSRF protection
- Uploads: type/size validation, re-encoding, EXIF stripping, private bucket for sensitive files
- **Breach incident register:** detection time, description, data categories, number of data subjects, risk level, actions, **72-hour NDPC notification countdown from awareness**, data-subject notification status, plus a notification email template
- **Retention jobs** (worker, scheduled): purge abandoned carts after 30 days, unverified accounts after 30 days, logs after 12 months, anonymise deleted accounts after grace period. All periods admin-configurable.
- **Data minimisation:** sellers see only name, phone, delivery address for fulfilment; customer phone masked 30 days after order completion
- RoPA and processors list editable in admin; audit log of every admin access to personal data

### 9.5 Consumer Protection UX
Seller identity and location on every listing; full price incl. delivery and fees before payment; real promotion end dates (no fake countdowns or scarcity); itemised receipt email with seller details and refund policy link.

---

## 10. Independent Database Design (PostgreSQL 16 + Prisma)

### 10.1 Conventions
- Primary keys: `uuid` (UUID v7 for time-ordering) — generated in app or via extension
- Every table: `created_at timestamptz default now()`, `updated_at timestamptz` (trigger-maintained); `deleted_at` for soft-delete where noted
- Money: `bigint` kobo; quantities: `numeric(12,3)` where fractional units allowed
- Statuses: Postgres enums (via Prisma enums)
- Foreign keys with explicit `ON DELETE` behaviour; index every FK
- Extensions: `pgcrypto`, `pg_trgm`, `btree_gist` (for booking exclusion constraints), `citext` (emails)
- Naming: snake_case tables/columns (`@@map` / `@map` in Prisma)

### 10.2 Schema (minimum — expand as needed)

**Identity & access**
- `users` — id, email (citext, unique), email_verified_at, phone_encrypted, phone_hash (unique), password_hash, name, avatar_url, status (active/suspended/pending_deletion/anonymised), deletion_requested_at, last_login_at
- `accounts`, `sessions`, `verification_tokens` — Auth.js Prisma adapter tables
- `user_roles` — user_id, role (customer/merchant/service_provider/staff/admin/super_admin)
- `otp_codes` — user_id/phone_hash, code_hash, purpose, expires_at, attempts
- `addresses` — user_id, label, recipient_name, phone_encrypted, line1_encrypted, line2_encrypted, city, state_id, lga_id, landmark, is_default
- `states`, `lgas` — seeded reference data (36 states + FCT and their LGAs)

**Sellers**
- `businesses` — id, owner_user_id, type (retailer/supermarket/vendor/merchant/producer/service_provider/artisan), name, slug (unique), description, logo_key, banner_key, cac_number, email, phone_encrypted, address_encrypted, state_id, lga_id, status (pending/under_review/approved/rejected/suspended), rejection_reason, rating_avg, rating_count, sells_products (bool), sells_services (bool)
- `business_staff` — business_id, user_id, permissions (jsonb), invited_at, accepted_at
- `business_kyc` — business_id, provider, provider_reference, verification_status, document_keys (private bucket), verified_at, reviewed_by
- `payout_accounts` — business_id, bank_code, account_number_last4, account_name, provider_subaccount_code, verified_at
- `store_policies` — business_id, return_window_days, pickup_address_encrypted, delivery_options (jsonb), accepts_pay_on_delivery

**Catalogue**
- `categories` — id, parent_id, name, slug, kind (product/service), icon, sort_order, is_active
- `attributes`, `category_attributes` — custom attributes per category
- `products` — id, business_id, category_id, title, slug, description_html, brand, tags (text[]), base_price_kobo, compare_at_price_kobo, cost_price_kobo, unit (piece/kg/litre/crate/bag/pack), min_order_qty, track_inventory, allow_backorder, weight_grams, dimensions (jsonb), is_perishable, shelf_life_note, status (draft/active/archived), meta_title, meta_description, search_vector (tsvector, GIN index), rating_avg, rating_count, deleted_at
- `product_images` — product_id, variant_id (nullable), storage_key, alt_text, width, height, sort_order, is_cover
- `product_options` — product_id, name (e.g. Size), values (text[])
- `product_variants` — product_id, sku (unique per business), barcode, option_values (jsonb), price_kobo, compare_at_price_kobo, stock_qty, low_stock_threshold, is_default
- `stock_movements` — variant_id, change_qty, reason (sale/reservation/release/refund_restock/manual_adjustment/import), reference_type, reference_id, note, actor_user_id
- `stock_reservations` — variant_id, cart_id/order_id, qty, expires_at, status (held/converted/released)
- `services` — id, business_id, category_id, title, slug, description_html, pricing_model (fixed/from/hourly/packages), base_price_kobo, duration_minutes, location_mode (on_site/at_provider/both), service_lgas (uuid[]), radius_km, deposit_percent, requires_confirmation, status, search_vector, rating_avg, rating_count, deleted_at
- `service_packages` — service_id, name, description, price_kobo, duration_minutes
- `service_images` — service_id, storage_key, alt_text, sort_order
- `service_availability` — service_id, weekday, start_time, end_time, slot_minutes, buffer_minutes, max_per_slot
- `service_blackouts` — service_id, starts_at, ends_at, reason

**Promotions**
- `promotions` — business_id (null = platform-wide), name, discount_type (percentage/fixed), discount_value, scope (product/products/category/store/service), starts_at, ends_at, usage_limit, per_customer_limit, min_order_kobo, is_flash_deal, is_active
- `promotion_targets` — promotion_id, target_type, target_id
- `coupons` — promotion_id, code (citext, unique), allows_stacking
- `promotion_redemptions` — promotion_id, coupon_id, order_id, user_id, discount_kobo

**Cart & orders**
- `carts` — user_id (nullable), guest_token_hash, expires_at
- `cart_items` — cart_id, variant_id / service_id + package_id, qty, booking_slot_start, saved_for_later
- `orders` — id, order_number (human-readable, unique, e.g. TM-2026-000123), user_id (nullable), guest_email, guest_phone_encrypted, shipping_address_snapshot (jsonb, encrypted fields), subtotal_kobo, discount_kobo, delivery_kobo, service_fee_kobo, vat_kobo, total_kobo, payment_status, terms_version_id, refund_policy_version_id, marketing_consent, placed_at
- `seller_orders` — order_id, business_id, status, subtotal_kobo, discount_kobo, delivery_kobo, commission_kobo, seller_net_kobo, delivery_method, tracking_number, delivered_at, escrow_release_at
- `order_items` — seller_order_id, variant_id, product_snapshot (jsonb: title, image, options), unit_price_kobo, qty, discount_kobo, line_total_kobo
- `order_status_history` — seller_order_id, from_status, to_status, actor_user_id, note
- `bookings` — id, order_id, seller_order_id, service_id, package_id, customer_user_id, starts_at, ends_at, time_range (tstzrange), location_snapshot, status, deposit_kobo, balance_kobo; **exclusion constraint** preventing overlapping confirmed bookings beyond capacity per service
- `booking_status_history`

**Payments, refunds & money**
- `payments` — order_id, provider (paystack/flutterwave/pay_on_delivery), provider_reference (unique), amount_kobo, status (initiated/success/failed/abandoned/reversed), channel, paid_at, raw_verification (jsonb)
- `payment_events` — provider, event_type, provider_event_id (unique — idempotency), signature_valid, payload (jsonb), processed_at, error
- `refunds` — seller_order_id, requested_by, reason, evidence_keys, amount_kobo, status (requested/approved/rejected/processing/completed/failed), provider_refund_reference, decided_by, decided_at
- `refund_items` — refund_id, order_item_id, qty, restock (bool)
- `disputes`, `dispute_messages`
- `payouts` — business_id, amount_kobo, provider_transfer_reference, status, period_start, period_end
- `commission_rules` — scope (global/category/business), scope_id, percent, fixed_kobo, effective_from

**10.3 Ledger (double-entry, append-only)**
- `ledger_accounts` — owner_type (platform/business/customer/provider_clearing), owner_id, type (escrow/available/commission/refunds/fees)
- `ledger_entries` — transaction_id, account_id, debit_kobo, credit_kobo, reference_type, reference_id, created_at
- Rule: every transaction's debits = credits (enforced by a DB constraint/trigger). Balances are computed from entries (with a materialised balance table refreshed transactionally). No updates/deletes allowed on entries.

**Engagement**
- `reviews` — target_type (product/service/business), target_id, order_item_id/booking_id (verified purchase), user_id, rating, body, image_keys, status (published/hidden/reported)
- `wishlists`, `messages` (per seller_order thread), `notifications`, `notification_preferences`

**Delivery**
- `delivery_zones` — name, state_ids, lga_ids
- `delivery_rates` — zone_id, business_id (nullable), min_weight_g, max_weight_g, fee_kobo, free_over_kobo, eta_days_min, eta_days_max

**Compliance & governance**
- `legal_documents` — slug, version, title, body_html, effective_at, published_by
- `policy_acceptances` — user_id/order_id/business_id, document_id, accepted_at, ip_hash, user_agent
- `consent_records` — user_id/anon_id, categories (jsonb), policy_version, ip_hash, user_agent, created_at
- `data_subject_requests` — requester_user_id or email, type (access/rectify/delete/object/restrict/portability/withdraw_consent), status, due_at, completed_at, handled_by, export_key, notes
- `breach_incidents` — detected_at, aware_at, description, data_categories, subjects_affected, risk_level, actions_taken, ndpc_notified_at, ndpc_deadline_at (aware_at + 72h), subjects_notified_at, status
- `processing_activities` (RoPA), `data_processors`, `dpia_records`
- `retention_settings` — data_type, retain_days, action (delete/anonymise)
- `audit_logs` — actor_user_id, actor_role, action, entity_type, entity_id, before (jsonb, redacted), after (jsonb, redacted), ip_hash, created_at — **append-only** (revoke UPDATE/DELETE from `townmart_app`)
- `settings` — key, value (jsonb)
- `job_runs` — job_name, started_at, finished_at, status, error (for admin health page)

### 10.4 Integrity & performance
- Critical operations as **single DB transactions** (or Postgres functions): place order (reserve stock, lock prices, apply promotion, create seller_orders), confirm payment (convert reservations, write ledger), process refund (ledger reversal, restock, status history)
- Use `SELECT ... FOR UPDATE` / optimistic version columns to prevent overselling
- Indexes: GIN on `search_vector` and trigram on titles; composite indexes for dashboard queries (`business_id, status, created_at`); partial indexes for active promotions and active products
- Connection pooling via PgBouncer (transaction mode) in production
- Read-heavy pages cached (ISR + Redis); avoid N+1 queries (Prisma `include`/`select` reviewed)

### 10.5 Backups, recovery & operations
- **Automated backups:** nightly `pg_dump` (logical) + continuous WAL archiving with **WAL-G or pgBackRest** for point-in-time recovery; backups encrypted and copied to a second location (different server/provider)
- **Retention:** daily for 14 days, weekly for 8 weeks, monthly for 12 months
- **Restore drill:** monthly automated restore into a scratch database with row-count verification; result shown on admin health page
- Targets: RPO ≤ 15 minutes, RTO ≤ 2 hours
- `scripts/db/` — `backup.sh`, `restore.sh`, `verify-restore.sh`, `rotate-keys.md`
- Monitoring: `pg_stat_statements` enabled; slow-query log; disk usage alerts
- Migrations are forward-only in production, reviewed in PR, and tested in CI against a fresh Postgres container plus a copy of seed data

### 10.6 Seed data
`prisma/seed.ts` with realistic Nigerian demo data: all states + LGAs; categories; ~6 sellers (supermarket in Ikeja, farm producer in Ogun, fashion vendor in Yaba, electronics retailer in Computer Village, a plumber and a tailor as artisans); ~60 products with variants and images; ~10 services with availability; sample promotions; sample orders, bookings, reviews; one admin and one super admin (credentials printed to console in dev only).

---

## 11. Engineering Standards

- Folder structure:
  - `app/(storefront)`, `app/(account)`, `app/(dashboard)`, `app/(admin)`, `app/legal`, `app/api` (webhooks, uploads)
  - `components/ui`, `components/*`
  - `lib/` — `db` (Prisma client + RLS context helper), `authz`, `pricing`, `payments`, `storage`, `notifications`, `search`, `crypto`, `validation`, `ledger`
  - `prisma/` (schema, migrations, seed), `sql/` (raw SQL: RLS, triggers, indexes)
  - `worker/` (BullMQ jobs), `scripts/db/`, `tests/`
  - `docker-compose.yml`, `docker-compose.prod.yml`, `Dockerfile`, `Caddyfile`
- Pricing/promotion and ledger logic in pure, fully unit-tested modules
- All Server Actions/route handlers: Zod validation → `authz` check → DB transaction with RLS context
- Error boundaries, `not-found` pages, structured logging (pino), Sentry-ready
- SEO: per-page metadata, Open Graph, `sitemap.xml`, `robots.txt`, JSON-LD (Product, Offer, AggregateRating, LocalBusiness, Service)
- `README.md` (one-command local start: `docker compose up` + `pnpm db:migrate` + `pnpm db:seed` + `pnpm dev`), `ARCHITECTURE.md` (Mermaid diagrams incl. ERD), `DATABASE.md` (schema overview, roles, RLS, backup/restore runbook)
- Small, descriptive commits per feature

---

## 12. Non-Functional Requirements

- p95 page load < 2.5s on mid-range Android over 4G
- p95 API response < 300ms for catalogue reads
- Zero overselling under concurrent checkout (prove with a load test: 50 concurrent buyers for 10 units)
- All personal data encrypted in transit and at rest
- No single-provider lock-in: DB, storage, email, SMS and payments each behind an interface

---

## 13. Build Phases (stop for review after each)

- **Phase 0 – Foundations:** scaffold Next.js; Docker Compose (Postgres, Redis, MinIO, Mailpit); Prisma setup; DB roles; base schema (users, auth, roles, states/LGAs, settings, audit log); Auth.js; RLS context helper; design tokens; layout shells; `.env.example`; README; CI
- **Phase 1 – Catalogue:** businesses + onboarding/KYC, categories, products, variants, images (presigned uploads), stock movements, services + availability, CSV import (worker), storefront listing/detail/search
- **Phase 2 – Promotions & pricing engine:** promotions, coupons, deals page, tested `lib/pricing`
- **Phase 3 – Cart, checkout, payments:** carts, stock reservations, order transaction, delivery rates, Paystack + Flutterwave, webhooks with idempotency, ledger entries, notifications
- **Phase 4 – Fulfilment & services:** order management, status history, bookings with exclusion constraint, messaging, reviews
- **Phase 5 – Refunds, disputes, payouts:** refund/return flows, provider refunds, ledger reversals, escrow release job, payouts, statements
- **Phase 6 – Compliance & legal:** versioned legal pages, consent manager, Privacy Centre, DSR queue + exports, breach register, retention jobs, RoPA, column encryption audit
- **Phase 7 – Admin console & analytics:** approvals, moderation, settings, dashboards, database & system health page
- **Phase 8 – Hardening & operations:** backups + PITR + restore drill scripts, production Docker setup, security review (OWASP Top 10), accessibility audit, Lighthouse, load test for overselling, Playwright E2E for purchase + refund + booking, deployment guide

---

## 14. Acceptance Criteria (definition of done)

- `docker compose up` + migrate + seed gives a fully working local TownMart with **no external database service**.
- A merchant can sign up, get approved, upload a product with 5 images, set price and stock, add a 15% promotion, and see it live with the discount badge.
- A service provider can publish a service with weekly availability and receive a confirmed booking; overlapping bookings beyond capacity are rejected by the database.
- A guest can buy from **two sellers** in one checkout using Paystack test mode; each seller sees only their portion.
- Stock decreases on payment, restocks on approved refund; load test shows zero overselling.
- Ledger balances always reconcile (debits = credits) after purchase, refund and payout flows.
- Cookie banner blocks analytics until consent; consent logged and changeable.
- Users can export their data and request deletion from the Privacy Centre; requests appear in the admin queue with deadlines.
- Admin can log a breach and see the 72-hour NDPC countdown.
- Legal pages linked in footer, versioned, accepted at checkout and seller sign-up.
- Tests prove cross-seller data access is blocked at both the app and RLS layers.
- Backup runs, restore drill passes, and the admin health page shows both timestamps.
- Lint, type-check and all tests pass; Lighthouse mobile ≥ 90.

---

**Start now with Phase 0. Show me your plan first, then build.**
