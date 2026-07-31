# 09 — Admin Orders screen

**What to build:** The store owner's daily triage view. They land in `/admin` on their orders, newest first, can filter to what needs action, open an order to see everything needed to fulfill it, and record fulfillment — marked shipped with a tracking number, plus internal notes for themselves.

**Blocked by:** 08, 06.

**Status:** done

- [x] Orders list is the default `/admin` landing screen, newest first, filterable by status (paid / shipped / refunded / cancelled)
- [x] Each row shows date, email, total, an item summary, and a status badge
- [x] Order detail shows the full line-item snapshot, shipping address, and a link out to the matching Stripe payment
- [x] Mark-shipped action, with an optional tracking number, updates status and records `shippedAt`
- [x] An internal note can be added to an order
- [x] All writes go through mutations that reuse the authorization helper from 08

## Comments

Implemented 2026-07-31. Notes for 10 and 11:

- **Reads are guarded too, not just writes.** The ticket asked for it on writes; `orders.list` and `orders.get` open with `requireAdmin` as well, because an order carries the customer's name, address, and email. Products (10) can leave `listActive` public — it is the storefront catalog — but any admin-only *field* (stock, `syncError`) belongs behind a guarded query, not tacked onto the public one.
- **`orders.get` takes the id as `v.string()` and normalizes it; the mutations take `v.id("orders")`.** The query's caller is a URL segment, so a mistyped `/admin/orders/<id>` should render "No such order" rather than throw an argument-validation error at the screen. The mutations' caller is a screen holding an order it already loaded, so a bad id there is a bug and argument validation should say so.
- **Validators derive from the schema.** `convex/schema.ts` now exports `orderValidator`, `orderItemValidator`, and `orderStatusValidator`, and the table is `defineTable(orderValidator.fields)`. `/admin`'s return validators are `.pick(...)`/`.extend(...)` over those rather than the row typed out a second time. Ticket 10 should do the same for products.
- **Two behaviours the ticket didn't spell out, both deliberate:**
  - `markShipped` refuses a `refunded` or `cancelled` order. Shipping over one would overwrite the status the Stripe Dashboard is the source of truth for (story 31), silently erasing the only record of the refund this store keeps. The detail screen shows an explanation in place of the form for those two statuses.
  - Omitting `trackingNumber` leaves a stored one alone; passing a blank one clears it. "Optional" means the caller may not have one to give, not that not giving one erases what a previous call recorded. Re-marking an already-shipped order keeps the original `shippedAt` — a corrected tracking number is not a second shipment.
- **The Stripe payment link's mode comes from `env.STRIPE_SECRET_KEY`** (`sk_test_` → `/test/` in the Dashboard URL), because a payment intent id doesn't say which half of Stripe it lives in. Read through the typed `env` from `_generated/server`, never `process.env` — same convention as ticket 04.
- **The list is capped at `MAX_ORDERS_LISTED` (200), in `lib/orders.ts`** so the query that enforces it and the screen that admits to it share one number. The screen says "Showing the 200 most recent orders" when it is at the cap. Past that the fix is `usePaginatedQuery`, not a bigger number.
- **`/admin/orders/<id>` is a route, so `AdminNav` gained an `alsoUnder` prefix** to keep the Orders tab lit while an order is open. Products and Settings match exactly; they have no sub-pages yet. If 10 adds `/admin/products/<id>`, it needs the same.
- **Live-query staleness in forms:** the tracking and note boxes are seeded from a Convex query that can update underneath them (a webhook flipping the order to `refunded`, a second tab). `useServerBackedField` in `OrderDetail.tsx` re-seeds during render when the server value changes, rather than remounting on a `key` — that is what lets the "Saved." feedback survive the query update the save itself causes. Ticket 10's product edit form has the same problem, harder (many fields).
- **Not verified against a live deployment.** Seam 1 tests cover the queries and mutations, including the authorization guarantee for all four (`convex/orders.admin.test.ts`, 21 tests); the screens themselves are UI rendering, which the spec's Testing Decisions puts outside automated tests. They still want the manual pass: sign in as the admin, confirm the list order and filters, open an order, mark it shipped, and click through to Stripe.
