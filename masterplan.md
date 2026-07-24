# all2beat.com — Rebuild Masterplan

**Project:** Replace the existing WooCommerce site at `https://www.all2beat.com` with a custom Next.js storefront + lightweight self-service admin.
**Client:** 2Beat — vegan snack bars, Tucson, Arizona, USA.
**Scale:** ~5 SKUs, low traffic, low order volume, USD only, US shipping.
**Strategy:** Own the stack. Stripe absorbs everything payment-related; we build only the storefront and a minimal admin.

---

## 1. Decisions already made (do not re-litigate)

| Decision | Choice | Consequence |
|---|---|---|
| Approach | Custom build, no Shopify/WordPress | No recurring platform fee; we own maintenance |
| Framework | Next.js (App Router, latest stable) | Server Actions for checkout, RSC for catalog |
| Database + backend | Convex | Products, orders, inventory, reservations |
| Auth | Clerk — **admin only** | No customer accounts anywhere |
| Payments | Stripe Checkout (hosted or embedded) | Zero custom checkout UI, zero PCI scope |
| Merchant tooling | Stripe Dashboard + our `/admin` | Stripe owns payments/refunds; we own catalog/fulfillment |
| Hosting | Vercel **Pro** | Hobby is non-commercial; this is a paying client site |
| Customer accounts | **None.** Guest checkout only | No `/account`, no order history, no password resets |
| Product source of truth | **Convex**, synced out to Stripe | Admin edits Convex; a Convex action mirrors to Stripe |
| Inventory | **Real stock counts** | Requires reservations + webhook-driven decrement |

**Target running cost:** Vercel Pro $20/mo + Convex free tier $0 + domain ~$15/yr + Stripe 2.9% + 30¢ per transaction. No platform subscription.

---

## 2. Non-goals (explicitly out of scope)

Do not build these. If they come up mid-build, note them and move on.

- Customer accounts, login, saved addresses, order-history pages
- Product reviews, ratings, wishlists, related-product engines
- A general-purpose CMS (marketing copy lives in code/MDX; the client is not editing the homepage)
- Multi-currency, i18n, multi-language
- Subscriptions or recurring billing
- Abandoned-cart recovery, email marketing, coupon-code engine (Stripe promo codes cover the rare case)
- Custom analytics dashboards — Stripe Dashboard + Vercel Analytics is the answer
- Custom refund flows — refunds happen in the Stripe Dashboard, our webhook just reflects the status
- Shipping-carrier / label-printing integrations

---

## 3. Architecture

```
Browser (guest)
  │
  ├─► Next.js on Vercel
  │     • RSC catalog pages, read from Convex
  │     • Cart in client state + localStorage (never trusted)
  │     • Server Action: createCheckoutSession()
  │           └─► validates cart against Convex
  │               reserves stock in Convex
  │               creates Stripe Checkout Session (server-side prices only)
  │
  ├─► Stripe Checkout (hosted page)
  │     • payment, 3DS, address collection, shipping selection, receipts
  │
  └─► redirect back to /checkout/success?session_id=...

Stripe  ──webhook──► Convex HTTP Action (/stripe/webhook)
                       • verify signature
                       • idempotency guard
                       • create order, commit stock decrement, release reservation

Admin (Clerk-gated) ──► Next.js /admin ──► Convex mutations
                                             └─► internal action mirrors product to Stripe
```

### Why the webhook goes to Convex, not Next.js

Point the Stripe webhook endpoint directly at a **Convex `httpAction`** rather than a Next.js route handler. Order creation and stock mutation are database concerns; routing them through Vercel adds a hop, a cold start, and raw-body handling friction for no benefit.

**Gotcha:** the Convex runtime is not Node. Use `stripe.webhooks.constructEventAsync(...)` (the SubtleCrypto variant), **not** `constructEvent(...)`, which requires Node's sync crypto and will fail.

---

## 4. Data model (Convex)

Write this into `convex/schema.ts` early; everything else hangs off it.

```ts
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  products: defineTable({
    slug: v.string(),                    // URL key, unique
    name: v.string(),
    description: v.string(),             // markdown allowed
    priceCents: v.number(),              // canonical price, USD cents
    compareAtCents: v.optional(v.number()), // for strikethrough pricing
    imageIds: v.array(v.id("_storage")), // Convex file storage
    stock: v.number(),                   // physical on-hand
    reserved: v.number(),                // held by in-flight checkouts
    active: v.boolean(),                 // visible in storefront
    sortOrder: v.number(),

    // Stripe mirror
    stripeProductId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    syncStatus: v.union(
      v.literal("pending"),
      v.literal("synced"),
      v.literal("error")
    ),
    syncError: v.optional(v.string()),
  })
    .index("by_slug", ["slug"])
    .index("by_active", ["active", "sortOrder"]),

  reservations: defineTable({
    stripeSessionId: v.string(),
    items: v.array(v.object({ productId: v.id("products"), qty: v.number() })),
    expiresAt: v.number(),               // epoch ms
    status: v.union(
      v.literal("held"),
      v.literal("committed"),
      v.literal("released")
    ),
  })
    .index("by_session", ["stripeSessionId"])
    .index("by_status_expiry", ["status", "expiresAt"]),

  orders: defineTable({
    stripeSessionId: v.string(),
    stripePaymentIntentId: v.optional(v.string()),
    email: v.string(),
    // snapshot — never join back to products for historical display
    items: v.array(
      v.object({
        productId: v.id("products"),
        name: v.string(),
        unitPriceCents: v.number(),
        qty: v.number(),
      })
    ),
    subtotalCents: v.number(),
    shippingCents: v.number(),
    taxCents: v.number(),
    totalCents: v.number(),
    shippingAddress: v.object({
      name: v.string(),
      line1: v.string(),
      line2: v.optional(v.string()),
      city: v.string(),
      state: v.string(),
      postalCode: v.string(),
      country: v.string(),
    }),
    status: v.union(
      v.literal("paid"),
      v.literal("shipped"),
      v.literal("refunded"),
      v.literal("cancelled")
    ),
    trackingNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
    paidAt: v.number(),
    shippedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_session", ["stripeSessionId"]),

  stripeEvents: defineTable({
    eventId: v.string(),                 // idempotency guard
    type: v.string(),
    processedAt: v.number(),
  }).index("by_event", ["eventId"]),
});
```

**Available stock = `stock - reserved`.** Never expose raw `stock` to the storefront; expose only a boolean or a low-stock hint.

---

## 5. The three flows that matter

Everything else in this project is presentation. Get these three right.

### 5.1 Checkout session creation (Server Action)

1. Client sends `[{ slug, qty }]` — **slugs and quantities only, never prices**.
2. Server loads those products from Convex, confirms `active === true`.
3. Server checks `stock - reserved >= qty` for every line. If any fails, return a structured error the UI can render ("Only 3 left of X").
4. Server computes subtotal, decides which shipping options to attach (see 5.4).
5. Server creates the Stripe Checkout Session:
   - `line_items` built from each product's `stripePriceId` (or `price_data` — see §6)
   - `mode: "payment"`
   - `expires_at`: now + 30 minutes (**must match the reservation TTL**)
   - `shipping_address_collection: { allowed_countries: ["US"] }`
   - `shipping_options`: computed in step 4
   - `automatic_tax`: per §8 decision
   - `metadata.reservationId`: our Convex reservation ID
   - `success_url` / `cancel_url`
6. Server writes the `reservations` row (status `held`, `expiresAt` matching) and increments each product's `reserved`.
7. Redirect the browser to the session URL.

Steps 3, 6 must happen inside a **single Convex mutation** so the stock check and the reserve are atomic. Create the Stripe session first (it can fail), then reserve — or reserve first and roll back on Stripe error. Pick one and be consistent; rolling back a reservation is cheaper than orphaning a Stripe session, so: **reserve first, release on Stripe failure.**

### 5.2 Webhook handling

Endpoint: Convex `httpAction` at `/stripe/webhook`.

Events to handle:

| Event | Action |
|---|---|
| `checkout.session.completed` | Idempotency check → create `orders` row from session + line items → set reservation `committed` → decrement `stock` by qty, decrement `reserved` by qty |
| `checkout.session.expired` | Set reservation `released` → decrement `reserved` (stock untouched) |
| `charge.refunded` | Find order by payment intent → set status `refunded`. Do **not** auto-restock; the client decides that in `/admin` |

**Every handler starts with the idempotency guard:** insert into `stripeEvents` by `eventId`; if it already exists, return 200 immediately and do nothing. Stripe retries, and a double-processed `checkout.session.completed` silently corrupts inventory.

**Always return 200 fast.** Non-2xx triggers Stripe retries. Validate, write, return.

### 5.3 Reservation sweeper

A Convex **cron** every 5 minutes: find reservations where `status === "held"` and `expiresAt < now`, set them `released`, decrement `reserved`.

This is the safety net for sessions that neither complete nor fire `expired` promptly. Without it, abandoned carts permanently eat inventory.

### 5.4 Shipping rules

Mirror the current site: **flat rate, free over $25.**

**Gotcha:** Stripe Checkout cannot conditionally apply a shipping rate based on cart total. You must decide server-side which `shipping_options` to attach when creating the session:

- subtotal ≥ $2500 cents → attach only the `$0 Free Shipping` rate
- subtotal < $2500 cents → attach only the flat-rate `$X Standard Shipping` rate

Create both `shipping_rate` objects once in the Stripe Dashboard and reference them by ID from env vars. Confirm the flat-rate amount with the client — the current site only advertises the free threshold.

---

## 6. Convex → Stripe product sync

Stripe **Price objects are immutable.** A price change means: create a new Price, point the product at it, archive the old one.

Flow, triggered by any admin product write:

1. Admin mutation writes the Convex doc and sets `syncStatus: "pending"`.
2. Same mutation calls `ctx.scheduler.runAfter(0, internal.stripe.syncProduct, { productId })`.
3. That **action** (`"use node"`, since it does network I/O) does:
   - no `stripeProductId` yet → `stripe.products.create` + `stripe.prices.create`
   - name/description changed → `stripe.products.update`
   - `priceCents` changed → `stripe.prices.create` (new), then `stripe.prices.update(old, { active: false })`
   - `active: false` → `stripe.products.update(id, { active: false })`
4. Action calls an internal mutation to write back `stripeProductId` / `stripePriceId` and set `syncStatus: "synced"` (or `"error"` + message).
5. `/admin` surfaces `syncStatus: "error"` prominently — a product that failed to sync cannot be sold.

**Scope-cut fallback:** if this sync proves annoying, drop it and use inline `price_data` in `line_items` instead, computing amounts server-side from Convex. Equally safe, less code. The cost is weaker per-product reporting in the Stripe Dashboard — which is a real loss here, since the Dashboard is part of the client's tooling. Try the sync first.

---

## 7. Admin panel (`/admin`)

Deliberately small. Clerk-gated, three screens.

**Access control:** Clerk middleware protects `/admin/*`. Authorization is a role check — `sessionClaims.publicMetadata.role === "admin"` — enforced **both** in middleware and in every Convex mutation that writes. Middleware alone is not authorization. Convex functions must independently verify identity via `ctx.auth.getUserIdentity()`.

### Screens

**Orders** (default landing screen)
- List: newest first, filter by status
- Row: date, email, total, item summary, status badge
- Detail: full line items, shipping address, link out to the Stripe payment
- Actions: mark shipped (+ optional tracking number), add internal note

**Products**
- List with stock, active toggle, sync status
- Edit form: name, slug, description, price, compare-at price, images, stock, active, sort order
- Stock is edited as an **absolute value** ("set stock to 48"), not a delta — less error-prone for a non-technical user
- Low-stock highlight (e.g. available < 5)

**Settings** (thin)
- Flat shipping rate amount, free-shipping threshold
- Store contact email
- Nothing else. Resist growth here.

---

## 8. Open items requiring client input

Flag these early; they block launch, not development.

1. **Sales tax.** Stripe Tax (`automatic_tax: { enabled: true }`) costs ~0.5% per transaction and requires registering the origin address and Arizona nexus in the Stripe Dashboard. Alternative: absorb tax into pricing. **This is the client's call and has legal implications — they should confirm with their accountant.** Build with a single env flag so it can be toggled without a code change.
2. **Flat shipping rate amount.** Current site only advertises "free over $25."
3. **Ship-to countries.** Assuming US-only. Confirm.
4. **Real product data.** The live site is mostly "coming soon" placeholders with a WooCommerce placeholder image. We need final names, descriptions, prices, and photography for all 5 SKUs.
5. **Brand direction.** Reuse the existing logo/palette, or is this a visual refresh too? Affects design time significantly.
6. **Shipping notification emails.** Stripe sends payment receipts automatically (enable in Dashboard). A "your order shipped" email requires Resend or similar (~$0 at this volume). Phase 2 unless the client insists.
7. **Existing WooCommerce data.** Any real historical orders or customers to preserve? If so, export before decommissioning.

---

## 9. Build phases

Sequenced so each phase ends somewhere demonstrable. Work one phase per Claude Code session where practical.

### Phase 0 — Foundations
- `create-next-app` (TypeScript, App Router, Tailwind), Convex init, Clerk init
- `convex/schema.ts` per §4
- Clerk ↔ Convex auth wiring (`convex/auth.config.ts`)
- Env var scaffolding, `.env.example` committed, real `.env.local` gitignored
- Deploy an empty app to Vercel to prove the pipeline works
- **Done when:** a deployed page reads a seeded product from Convex prod

### Phase 1 — Catalog & storefront shell
- Product queries, seed script for the 5 SKUs
- Layout, nav, footer, homepage, `/shop`, `/product/[slug]`, `/about`, `/contact`
- Convex file storage for images; configure `next.config` `images.remotePatterns` for the Convex storage domain
- **Done when:** the full catalog browses correctly on mobile and desktop, no cart yet

### Phase 2 — Cart
- Client-side cart (context + `localStorage`, hydration-safe)
- Add-to-cart, quantity edit, remove, cart drawer/page, subtotal, free-shipping progress indicator
- **Done when:** cart survives refresh and computes totals correctly. Still no payment.

### Phase 3 — Checkout (the core)
- Stripe product sync action (§6)
- `createCheckoutSession` server action (§5.1) with reservation logic
- Convex `httpAction` webhook + idempotency + order creation + stock commit (§5.2)
- Reservation sweeper cron (§5.3)
- Shipping options logic (§5.4)
- Success and cancel pages
- **Done when:** a Stripe **test-mode** purchase produces a correct `orders` row and correct stock movement, and a deliberately abandoned session releases its reservation

### Phase 4 — Admin
- Clerk-gated `/admin`, role check in middleware **and** in every Convex mutation
- Orders list/detail, mark-shipped
- Products CRUD with image upload and sync-status surfacing
- Settings
- **Done when:** the client could add a product and fulfill an order without touching code

### Phase 5 — Polish & launch prep
- SEO: metadata, OG images, `sitemap.ts`, `robots.ts`, product JSON-LD
- 301 redirects from old WooCommerce URLs (§10)
- 404/500 pages, loading and empty states, accessibility pass
- Lighthouse pass, Vercel Analytics
- Legal pages: privacy, terms, shipping & returns policy (client supplies the text)
- **Done when:** ready for the go-live checklist

### Phase 6 — Go live
See §11.

---

## 10. Migration from WooCommerce

The old site's URL structure must be preserved or redirected. Known paths from the live site:

| Old | New |
|---|---|
| `/shop/` | `/shop` |
| `/product/<slug>/` | `/product/<new-slug>` (map each of the 5 individually) |
| `/about-us/` | `/about` |
| `/contact-us/` | `/contact` |
| `/my-account/`, `/cart/`, `/checkout/` | `/` (no customer accounts now) |
| `/?page_id=404` ("Our Products") | `/shop` |

Implement in `next.config.ts` `redirects()` with `permanent: true`. Crawl the old site for any additional indexed URLs before cutover.

Also strip: the old site leaks WordPress plugin paths and a WooCommerce placeholder image. Neither should survive.

---

## 11. Go-live checklist

- [ ] Stripe account switched from test to **live** keys everywhere
- [ ] Live-mode webhook endpoint registered, pointing at the **production** Convex URL, signing secret in prod env
- [ ] Products re-synced in live mode (test-mode Stripe products do **not** carry over)
- [ ] Shipping rate objects recreated in live mode, IDs updated in prod env
- [ ] Stripe email receipts enabled in Dashboard settings
- [ ] Stripe Tax configured (or explicitly declined in writing)
- [ ] Convex production deployment, not dev
- [ ] Vercel on **Pro** (commercial use requirement)
- [ ] Custom domain + SSL on Vercel; DNS cut over from the old host
- [ ] Old WordPress site archived (full export kept) before teardown
- [ ] Client's Clerk admin account created and role assigned
- [ ] One real end-to-end live purchase, then refunded via Dashboard
- [ ] Redirects verified against a crawl of the old site
- [ ] Client walkthrough of `/admin` + the Stripe Dashboard

---

## 12. Known gotchas — read before coding

1. **Never trust client-supplied prices.** The cart sends slugs and quantities. Prices come from Convex, server-side, always.
2. **`constructEventAsync`, not `constructEvent`,** in the Convex runtime.
3. **Idempotency on every webhook.** Stripe retries. Duplicate `checkout.session.completed` handling silently corrupts inventory.
4. **Stripe Prices are immutable.** Price edits create new Price objects and archive old ones.
5. **Session `expires_at` must match the reservation TTL,** or you leak or prematurely release stock.
6. **Shipping rate selection is server-side.** Stripe Checkout won't conditionally apply free shipping for you.
7. **Test-mode and live-mode Stripe objects are separate universes.** Product IDs, price IDs, shipping rate IDs, webhook secrets — all need recreating at launch.
8. **Vercel Hobby is non-commercial.** This site takes money. Pro from day one.
9. **Middleware is not authorization.** Every Convex mutation that writes must independently verify the caller's identity and role.
10. **Order line items are snapshots.** Never render a historical order by joining to the live `products` table — prices and names change.

---

## 13. Suggested `CLAUDE.md` conventions

Drop these into the repo's `CLAUDE.md` so they persist across Claude Code sessions:

- Money is always **integer cents** (`priceCents`), never floats. Format only at the render boundary.
- Convex validators (`v.*`) on every function argument. No `any`.
- Reads through Convex queries; writes through mutations; anything touching the network through actions.
- Stripe SDK is only ever imported in Convex actions and Next.js server code — **never** in a client component.
- Server Actions validate input with Zod at the boundary.
- No new dependency without justification. The stack is Next.js, Convex, Clerk, Stripe, Tailwind. That's the list.
- Prefer Server Components; add `"use client"` only where interactivity genuinely requires it (cart, admin forms).
- After any schema change, update the seed script in the same commit.
- Every phase in §9 ends with a manual verification step. Don't advance until it passes.
