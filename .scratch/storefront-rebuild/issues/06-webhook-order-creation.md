# 06 — Webhook, order creation & stock commit

**What to build:** Completed payments turn into orders and move inventory — reliably and exactly once. Stripe's webhook hits a Convex HTTP action that verifies the signature, guards against duplicate deliveries, and on a completed checkout creates the order, commits the reservation, and decrements stock. Expiry releases held stock; a Dashboard refund flips the order to refunded without restocking. Inventory decrements only after payment actually completes.

**Blocked by:** 05.

**Status:** ready-for-verification

- [x] Convex `httpAction` at `/stripe/webhook` verifies the signature with `constructEventAsync` (the SubtleCrypto variant — the Convex runtime is not Node)
- [x] Every handler starts with an idempotency guard against `stripeEvents` by `eventId`; an already-seen event returns 200 and does nothing
- [x] `checkout.session.completed` → create the `orders` row from a line-item snapshot, set the reservation `committed`, decrement `stock` and `reserved` by the ordered quantities
- [x] `checkout.session.expired` → set the reservation `released`, decrement `reserved` only (stock untouched)
- [x] `charge.refunded` → find the order by payment intent, set status `refunded`; do not auto-restock
- [x] Always returns 200 quickly (non-2xx triggers Stripe retries)
- [x] Seam 1 tests: replaying the same `eventId` is a no-op; commit/release/refund transitions produce correct table state
- [x] Seam 2 test: a real signed event via `generateTestHeaderString` POSTed to the deployed webhook is accepted, and a tampered payload is rejected (the raw-body gotcha mocks can't catch)
- [ ] Done when: a test-mode purchase produces a correct order row and correct stock movement

## Comments

Implemented 2026-07-27. The last box is the store owner's to tick — it needs a real webhook endpoint registered in the Stripe Dashboard (see "Before this can be verified" below).

- **The split is: verification in `http.ts`, every rule in `orders.ts`.** The endpoint verifies the signature, pulls the handful of fields it needs out of the Stripe object, and hands plain data to exactly one internal mutation per event. That boundary exists because **an httpAction is not a transaction** — only a mutation is. Putting the idempotency guard and the work it guards in separate `runMutation` calls would leave a window where a retry sees an unclaimed event and re-applies it, which is precisely the corruption masterplan §11.3 warns about. One event, one mutation, guard included.
- **The guard is defended three deep, and the tests know the difference.** `stripeEvents.eventId` catches Stripe's retries; an `orders` lookup `by_session` catches a *fresh* event id for a session already ordered (a Dashboard resend); and the reservation's own status catches everything else. Worth knowing: when I first wrote the tests, removing the `stripeEvents` guard entirely still passed all of them — the other two masked it. The replay tests now assert the `stripeEvents` row count as well, so the guard is pinned by something that fails without it.
- **A payment can arrive *after* its hold was released, and it still has to take the stock.** The reservation and the Stripe session expire at the same instant, so a payment taken a moment before expiry can be delivered a moment after ticket 07's sweeper handed the units back. The first version returned early on any non-`held` reservation and silently skipped the decrement — an oversell, found in review. `recordCheckoutCompleted` now skips only `committed`, and for a `released` row decrements `stock` while leaving `reserved` alone (the release already corrected that one). Ticket 07 should not "fix" this by refusing to sweep.
- **`reservations.items` now carries the price, and this is load-bearing.** `name`/`unitPriceCents` are snapshotted at reserve time, because that is the price Stripe charges: the session holds the `stripePriceId` captured then, so an Admin price change during the 30-minute hold does not follow the shopper. Re-reading `products` at webhook time — the obvious implementation — would write an order that disagrees with what the customer actually paid, breaking `CONTEXT.md`'s "Order is an immutable snapshot ... exactly as they were at time of sale". The fields are optional purely so reservation rows written before this ticket still validate; the fallback path logs loudly.
- **The order is written even when the reservation is missing.** Money has changed hands; refusing to record the sale because our own bookkeeping row vanished would be the worse failure. The line snapshot is what's lost, and it's logged.
- **`charge.refunded` uses `.first()`, not the `.unique()` used everywhere else.** `.unique()` throws when it finds two, a throw means a 500, and a 500 means Stripe retries that delivery forever. Reflecting the refund on the oldest matching order beats jamming the queue.
- **Unhandled event types get a 200 and no `stripeEvents` row.** Nothing was applied, so there is nothing to guard against re-applying — and Stripe should not be retrying an event we deliberately ignore.
- **`STRIPE_WEBHOOK_SECRET` is declared in `convex/convex.config.ts`** and read through the typed `env`, like `STRIPE_SECRET_KEY`. It is deployment-scoped and, unlike the secret key, never belongs in `.env.local` — the only code that reads it runs on Convex. It is *optional* in the config: an unset secret must surface as a 500 on delivery, not a deployment that refuses to start.
- **Seam 2 (`convex/http.seam2.test.ts`) posts real signed events over the network to the deployed endpoint** and is the only test that can catch the raw-body gotcha — a mock accepts whatever string it is handed, so only a real signature over real bytes proves `constructEventAsync` and `request.text()` agree. It reads the signing secret back out of the deployment via `npx convex env get` rather than duplicating it into `.env.local`, warns loudly when it skips, and mostly signs an *ignored* event type so a run leaves no rows behind (one test does go into a handler, with a per-run unique event id).
- **A placeholder `whsec_` is currently set on the dev deployment** so those tests can run. It proves signature verification, which is self-contained — but real Stripe deliveries will 400 until it is replaced with the Dashboard's actual endpoint secret.

### Before this can be verified

1. Stripe Dashboard → Developers → Webhooks → add endpoint `https://<deployment>.convex.site/stripe/webhook`, subscribed to `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`.
2. `npx convex env set STRIPE_WEBHOOK_SECRET whsec_…` with that endpoint's signing secret (replacing the placeholder).
3. Buy something in test mode and check the `orders` row, `reservations.status`, and the product's `stock`/`reserved`.

Local alternative: `stripe listen --forward-to https://<deployment>.convex.site/stripe/webhook` prints its own `whsec_` — a different secret, so set whichever one you're using.
