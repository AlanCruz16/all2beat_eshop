# 06 — Webhook, order creation & stock commit

**What to build:** Completed payments turn into orders and move inventory — reliably and exactly once. Stripe's webhook hits a Convex HTTP action that verifies the signature, guards against duplicate deliveries, and on a completed checkout creates the order, commits the reservation, and decrements stock. Expiry releases held stock; a Dashboard refund flips the order to refunded without restocking. Inventory decrements only after payment actually completes.

**Blocked by:** 05.

**Status:** ready-for-agent

- [ ] Convex `httpAction` at `/stripe/webhook` verifies the signature with `constructEventAsync` (the SubtleCrypto variant — the Convex runtime is not Node)
- [ ] Every handler starts with an idempotency guard against `stripeEvents` by `eventId`; an already-seen event returns 200 and does nothing
- [ ] `checkout.session.completed` → create the `orders` row from a line-item snapshot, set the reservation `committed`, decrement `stock` and `reserved` by the ordered quantities
- [ ] `checkout.session.expired` → set the reservation `released`, decrement `reserved` only (stock untouched)
- [ ] `charge.refunded` → find the order by payment intent, set status `refunded`; do not auto-restock
- [ ] Always returns 200 quickly (non-2xx triggers Stripe retries)
- [ ] Seam 1 tests: replaying the same `eventId` is a no-op; commit/release/refund transitions produce correct table state
- [ ] Seam 2 test: a real signed event via `generateTestHeaderString` POSTed to the deployed webhook is accepted, and a tampered payload is rejected (the raw-body gotcha mocks can't catch)
- [ ] Done when: a test-mode purchase produces a correct order row and correct stock movement
