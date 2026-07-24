Status: ready-for-agent

# Storefront Rebuild — all2beat.com

Covers masterplan Phases 0–4 (Foundations, Catalog & storefront shell, Cart, Checkout, Admin) — the functional commerce core. Phase 5 (visual/brand design, SEO polish) and Phase 6 (go-live ops) are separate, later efforts and are out of scope here; see "Out of Scope."

Source material: `masterplan.md`, `CONTEXT.md`, `docs/adr/0001`–`0004`.

## Problem Statement

2Beat (vegan snack bars, Tucson, AZ) runs its store on WordPress + WooCommerce: a recurring platform to maintain, a checkout and catalog experience the store owner doesn't fully control, and tooling mismatched to a ~5-SKU, low-volume business. The store owner wants an owned, low-maintenance storefront where Stripe absorbs as much of the payment complexity as possible, while still being able to run day-to-day catalog, inventory, and order operations themselves without calling a developer for routine changes.

## Solution

A custom Next.js storefront on Vercel, backed by Convex (Product/Order/Reservation/Settings data) and Clerk (admin-only auth), with Stripe's embedded Checkout handling payment, address collection, and receipts. Guests browse and buy with no account. The store owner manages orders, products, and store-wide settings (shipping rate, free-shipping threshold, tax toggle, contact email) through a small `/admin`, self-service, without touching the Stripe Dashboard or requiring a redeploy for routine changes. Product records are owned in Convex and mirrored out to Stripe so the Dashboard stays a trustworthy secondary view.

## User Stories

**Catalog & storefront**

1. As a shopper, I want to browse the full list of active products on a `/shop` page, so that I can see what's available to buy.
2. As a shopper, I want to view a single product's detail page (name, description, price, images, stock status), so that I can decide whether to buy it.
3. As a shopper, I want a homepage that introduces the store and its products, so that I understand what 2Beat sells before navigating further.
4. As a shopper, I want an `/about` page describing the brand, so that I can learn about the company.
5. As a shopper, I want a `/contact` page, so that I can reach the store with questions.
6. As a shopper, I want to see a low-stock indicator on products that are running out, so that I know to act quickly.
7. As a shopper, I want inactive products to never appear in the catalog, so that I don't try to buy something the store isn't currently selling.
8. As a shopper, I want product images to load reliably on any device, so that I can actually see what I'm buying.
9. As a shopper, I want to never see the store's exact on-hand stock count, only a boolean or low-stock hint, so that the store's raw inventory numbers stay private.

**Cart**

10. As a shopper, I want to add a product to my cart with a chosen quantity, so that I can buy more than one item.
11. As a shopper, I want to view my cart's contents, quantities, and subtotal, so that I know what I'm about to pay.
12. As a shopper, I want to change a cart item's quantity or remove it, so that I can correct mistakes before checkout.
13. As a shopper, I want my cart to survive a page refresh, so that I don't lose my selections by accident.
14. As a shopper, I want a free-shipping progress indicator ("$X more for free shipping"), so that I'm encouraged to add more to my order.
15. As a shopper, I want the price I'm shown in my cart to always match the store's actual current price, so that I'm never mistakenly overcharged or undercharged relative to what's displayed.

**Checkout**

16. As a shopper, I want to check out without creating an account, so that buying is fast and frictionless.
17. As a shopper, I want checkout embedded directly in the site rather than redirected to another domain, so that the experience feels seamless.
18. As a shopper, I want to be told immediately if an item in my cart doesn't have enough stock, so that I can adjust my order before paying.
19. As a shopper, I want my shipping cost calculated automatically — a flat rate below a threshold, free at or above it — so that I don't have to guess or look it up.
20. As a shopper, I want to enter my US shipping address during checkout, so my order can be delivered.
21. As a shopper, I want an automatic payment receipt emailed to me after paying, so I have proof of purchase.
22. As a shopper, if I abandon checkout, I want the items I was buying to become available to other shoppers again within a few minutes, so inventory isn't permanently locked up by abandoned carts.
23. As the store owner, I want inventory to decrement only once a payment actually completes, never before, so stock counts stay accurate even when shoppers abandon checkout.
24. As the store owner, I want duplicate webhook deliveries from Stripe to never double-count an order or double-decrement stock, so a network retry can't corrupt my inventory.
25. As the store owner, I want sales tax collection to be a single toggle, off by default, so I can turn it on later once my accountant confirms nexus registration — without needing a code change.

**Admin — Orders**

26. As the store owner, I want to log into `/admin` and see my most recent orders first, so I can quickly triage new business.
27. As the store owner, I want to filter orders by status (paid / shipped / refunded / cancelled), so I can find what needs action.
28. As the store owner, I want to view a single order's full detail — line items, shipping address, and a link out to the matching Stripe payment — so I have everything I need to fulfill it.
29. As the store owner, I want to mark an order shipped and optionally attach a tracking number, so my records reflect fulfillment status.
30. As the store owner, I want to add an internal note to an order, so I can record fulfillment context for myself.
31. As the store owner, when I issue a refund from the Stripe Dashboard, I want the matching order's status to update to "refunded" automatically, so I don't maintain two systems by hand.
32. As the store owner, I do not want a refund to automatically restock inventory, so I retain control over when a returned or refunded item is actually resellable.

**Admin — Products**

33. As the store owner, I want to see all products with their current stock, active status, and Stripe sync status at a glance, so I can spot problems quickly.
34. As the store owner, I want to edit a product's name, description, price, compare-at price, images, stock, active flag, and sort order, so I can keep my catalog accurate.
35. As the store owner, I want to set a product's stock to an exact number rather than adding or subtracting, so correcting a count is unambiguous.
36. As the store owner, I want a clear, prominent warning when a product fails to sync to Stripe, so I know it currently can't be sold.
37. As the store owner, I want to deactivate a product so it disappears from the storefront without deleting it, so seasonal or discontinued items don't need to be destroyed.

**Admin — Settings**

38. As the store owner, I want to change my flat shipping rate and free-shipping threshold myself from `/admin`, so I don't need a developer or a deploy to adjust pricing.
39. As the store owner, I want to toggle sales tax collection on or off myself from `/admin`, so I can enable it the moment my accountant confirms nexus registration.
40. As the store owner, I want to update my store's contact email from `/admin`, so customer-facing contact info stays current.

**Admin — Access**

41. As the store owner, I want `/admin` to be the only place anyone logs in, so my customers never need accounts anywhere on the site.
42. As the store owner, I want to be the only person who can access `/admin`, so my catalog and order data stay private.

**Launch groundwork**

43. As the store owner, I want my known old-site URLs (`/shop/`, `/product/<slug>/`, `/about-us/`, `/contact-us/`, `/my-account/`, `/cart/`, `/checkout/`, the WooCommerce "Our Products" page-id URL) to redirect to their new-site equivalents, so existing links and search-engine results keep working.
44. As the store owner, I want none of the old WordPress/WooCommerce plugin paths or placeholder imagery reachable on the new site, so the relaunch looks like a real product, not a leftover WordPress install.

## Implementation Decisions

**Data model (Convex)** — five tables, per masterplan §4 and ADR-0004:
- `products`: slug, name, description, priceCents, compareAtCents, imageIds, stock, reserved, active, sortOrder, plus the Stripe mirror fields (`stripeProductId`, `stripePriceId`, `syncStatus: "pending"|"synced"|"error"`, `syncError`). Indexed by slug and by (active, sortOrder).
- `reservations`: stripeSessionId, items (productId + qty), expiresAt, status (`held`|`committed`|`released`). Indexed by session and by (status, expiresAt) for the sweeper.
- `orders`: stripeSessionId, stripePaymentIntentId, email, a line-item snapshot (never joined back to `products`), subtotal/shipping/tax/total in cents, shippingAddress, status (`paid`|`shipped`|`refunded`|`cancelled`), trackingNumber, notes, paidAt, shippedAt. Indexed by status and by session.
- `stripeEvents`: eventId, type, processedAt — the idempotency guard for the webhook.
- `settings` (singleton row, ADR-0004): taxEnabled (boolean, default false), shippingFlatRateCents (default 500), freeShippingThresholdCents (default 2500), contactEmail. Read live by checkout-session creation; edited via `/admin` Settings. This table exists specifically so shipping/tax values are Admin-editable without touching a Stripe Dashboard object or redeploying — it supersedes the idea of pre-created Stripe `shipping_rate` objects referenced by env var.

**Checkout session creation** (Server Action, masterplan §5.1):
- Input from the client is `[{ slug, qty }]` only — never a price.
- Server loads the matching `products`, confirms `active === true`, and checks `stock - reserved >= qty` per line inside a single Convex mutation (atomic stock-check + reserve).
- Reserve first, then create the Stripe Checkout Session; on Stripe failure, roll back the reservation (cheaper to release a reservation than orphan a Stripe session).
- Session uses `ui_mode: "embedded_page"` (ADR-0003 — Stripe's current name for embedded mode; not hosted redirect), `mode: "payment"`, `expires_at` set to match the reservation's `expiresAt` (30 minutes), `shipping_address_collection` restricted to `["US"]`, `automatic_tax: { enabled: settings.taxEnabled }`, and `metadata.reservationId`.
- Shipping is attached as dynamic `shipping_options[].shipping_rate_data`, computed from `settings.shippingFlatRateCents` / `settings.freeShippingThresholdCents` at request time (ADR-0004) — not a static pre-created Stripe `shipping_rate` object ID.
- The action returns `session.client_secret` (embedded mode's contract; not `session.url`). The client renders Stripe's `EmbeddedCheckoutProvider`/`EmbeddedCheckout` (new dependencies: `@stripe/stripe-js`, `@stripe/react-stripe-js`). The return page calls `retrieveSession` client-side against `return_url` to confirm `session.status` before showing a success state.

**Webhook handling** (Convex `httpAction`, masterplan §5.2):
- Endpoint verifies the Stripe signature with `stripe.webhooks.constructEventAsync` (the SubtleCrypto variant — the Convex runtime is not Node, `constructEvent` will not work).
- Every handler starts with an idempotency check against `stripeEvents` by `eventId`; if already processed, return 200 and do nothing.
- `checkout.session.completed` → create the `orders` row from the session/line items, set the matching reservation `committed`, decrement `stock` and `reserved` by the ordered quantities.
- `checkout.session.expired` → set the reservation `released`, decrement `reserved` only (stock untouched).
- `charge.refunded` → find the order by payment intent, set status `refunded`. Do not auto-restock.
- Always return 200 quickly; a non-2xx response triggers Stripe retries.

**Reservation sweeper** (Convex cron, masterplan §5.3): every 5 minutes, find `held` reservations past their `expiresAt`, set them `released`, decrement `reserved`. Safety net for sessions that neither complete nor fire `expired` promptly.

**Convex → Stripe product sync** (masterplan §6, confirmed by ADR-0001 — not the Stripe-Dashboard-first alternative): any Admin write to a product sets `syncStatus: "pending"` and schedules an internal Node action. That action creates/updates the Stripe Product and Price (Prices are immutable — a price change creates a new Price and archives the old one), then writes back `stripeProductId`/`stripePriceId` and `syncStatus: "synced"` or `"error"` + message. `/admin` surfaces `syncStatus: "error"` prominently; a product in that state cannot be sold.

**Admin panel** (`/admin`, masterplan §7): Clerk-gated, single admin, flat role check — `sessionClaims.publicMetadata.role === "admin"` — enforced in both Clerk middleware and independently inside every Convex mutation that writes (`ctx.auth.getUserIdentity()`); middleware alone is not authorization. Three screens: Orders (default landing — list/filter/detail, mark-shipped, notes), Products (list + edit form, stock as an absolute value, low-stock highlight), Settings (tax toggle, shipping rate, free-shipping threshold, contact email — backed by the `settings` table).

**URL redirects** (masterplan §10): implement the known old→new path table (`/shop/`→`/shop`, `/product/<slug>/`→`/product/<new-slug>` mapped individually per SKU, `/about-us/`→`/about`, `/contact-us/`→`/contact`, `/my-account/`/`/cart/`/`/checkout/`→`/`, the WooCommerce page-id URL→`/shop`) via `next.config.ts` `redirects()` with `permanent: true`. No crawl of the old site for additional URLs — the known table is the full set (per grilling-session resolution).

## Testing Decisions

Two seams, matched to what's actually at risk in a payments system (see grilling-session discussion):

**Seam 1 — Convex function boundary (the bulk of coverage, fast, in-process).** Test via a harness that invokes Convex queries/mutations/actions directly (e.g. `convex-test`), with the Stripe SDK mocked/stubbed inside actions. This is where exhaustive edge-case coverage belongs:
- Stock/reservation math: exact-stock, over-stock, concurrent-reservation, and release/commit transitions.
- Idempotency: replaying the same `stripeEvents.eventId` is a no-op.
- Reservation sweeper: only `held` + past-`expiresAt` rows are released; `committed`/already-`released` rows are untouched.
- Settings-driven shipping/tax math: threshold boundary (exactly at, just under, just over), tax-flag on/off.
- Admin mutation authorization: writes are rejected for a non-admin or unauthenticated identity, independent of what middleware would have done.
- Product sync state transitions (`pending`→`synced`, `pending`→`error`, price-change → new Price + archived old Price) against the mocked Stripe client.
Prefer testing observable outcomes (table state after the call, return value, thrown error) over internal call sequencing.

**Seam 2 — Real Stripe test-mode integration (small in number, slower, no mocks).** These exist specifically to catch the gap mocks can't: whether our actual usage of the Stripe API is valid, and whether webhook signature verification genuinely works end-to-end.
- Call `stripe.checkout.sessions.create()` against Stripe's real test-mode API with our actual parameter shape (embedded mode, dynamic `shipping_rate_data`, `automatic_tax`) and assert it succeeds.
- Construct a real signed event with `stripe.webhooks.generateTestHeaderString` and POST it to the actual deployed webhook `httpAction`, asserting `constructEventAsync` accepts a correctly signed payload and rejects a tampered one — this is the one gotcha (raw-body handling) that a mocked test cannot catch.

**Explicitly not covered by automated tests**: UI rendering (catalog pages, cart interactions, the embedded checkout widget, admin forms). Each build phase closes with the manual "Done when" verification step already defined in masterplan §9 — this is a deliberate choice for a low-traffic, 5-SKU store, not an oversight.

## Out of Scope

- Customer accounts, login, saved addresses, order-history pages (masterplan §2 — permanent non-goal, not a phased deferral).
- Product reviews, ratings, wishlists, related-product engines.
- A general-purpose CMS; marketing copy lives in code/MDX.
- Multi-currency, i18n, multi-language.
- Subscriptions or recurring billing.
- Abandoned-cart recovery, email marketing, coupon-code engine.
- Custom analytics dashboards, custom refund flows, shipping-carrier/label-printing integrations.
- Visual/brand design pass (masterplan Phase 5) — this build is functional-first; default/unstyled UI is acceptable here by design.
- SEO metadata/sitemap/JSON-LD, accessibility pass, Lighthouse pass, legal pages (Phase 5).
- Go-live operations — live-mode key/webhook cutover, DNS, Vercel Pro upgrade, client walkthrough (Phase 6).
- Crawling the old WooCommerce site for additional indexed URLs beyond the known redirect table (ADR — resolved during grilling, known table is sufficient).
- Any WooCommerce content or historical order/customer data migration — product data is sourced first-hand from the client; historical data is archived for the client's own records only, never imported (ADR-0002).
- Shipping-notification ("your order shipped") emails — deferred indefinitely; only Stripe's automatic payment-receipt email exists.
- Multiple admin accounts or permission tiers — single flat admin role only.
- Actually enabling Stripe Tax or setting the real (non-placeholder) shipping rate — both remain client-supplied values to be entered into `/admin` Settings before launch, not part of this build.

## Further Notes

Full context and rationale live in `masterplan.md` (the working plan for all phases, including 5 and 6), `CONTEXT.md` (domain glossary), and `docs/adr/0001`–`0004` (the four architectural decisions this spec assumes as settled). Phases 5 and 6 should get their own spec(s) once this core is built and the client has supplied real product data, the real shipping rate, and a brand/design direction.
