# 05 — Checkout session creation, embedded checkout & reservations

**What to build:** A shopper can take a cart all the way to Stripe's embedded checkout, on-site, without an account. The server re-validates the cart from scratch (slugs and quantities only — never trusting client prices), atomically checks and reserves stock, and creates an embedded Stripe session with shipping and tax computed live from `settings`. Stock is held for the session's lifetime and released if Stripe creation fails. The shopper pays inside the site and lands on a return page that confirms the outcome.

**Blocked by:** 03, 04.

**Status:** ready-for-agent

- [ ] `createCheckoutSession` Server Action takes `[{ slug, qty }]` only; input validated at the boundary
- [ ] Server loads the products, confirms `active === true`, and checks `stock − reserved >= qty` per line, returning a structured error the UI can render on failure
- [ ] Stock check and reservation happen inside a single Convex mutation (atomic); reserve first, release the reservation if the Stripe call then fails
- [ ] Session uses `ui_mode: "embedded_page"` (ADR-0003), `mode: "payment"`, `expires_at` matching the reservation TTL (30 min), `shipping_address_collection` restricted to US, `metadata.reservationId`
- [ ] Shipping attached as dynamic `shipping_options[].shipping_rate_data` and `automatic_tax` both computed from the live `settings` row (ADR-0004) — no static Stripe `shipping_rate` objects
- [ ] Action returns `session.client_secret`; the checkout page renders `EmbeddedCheckoutProvider` / `EmbeddedCheckout` (new deps `@stripe/stripe-js`, `@stripe/react-stripe-js`)
- [ ] A `/checkout/return` page calls `retrieveSession` client-side to confirm `session.status` before showing success
- [ ] Seam 1 tests cover reservation/stock math (exact-stock, over-stock, concurrent reserve, release-on-failure) and settings-driven shipping/tax math (threshold boundary, tax flag on/off)
- [ ] The Seam 2 real-Stripe test-mode harness is established; a Seam 2 test asserts `sessions.create()` accepts our actual parameter shape (embedded, dynamic `shipping_rate_data`, `automatic_tax`)
