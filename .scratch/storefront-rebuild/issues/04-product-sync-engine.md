# 04 — Convex→Stripe product sync engine

**What to build:** Products stay owned in Convex and are mirrored out to Stripe automatically, so the Stripe Dashboard is a trustworthy secondary view (ADR-0001). Any write to a product schedules a sync; the sync creates/updates the Stripe Product and Price, handles the fact that Prices are immutable, and records whether it succeeded — so a product that failed to sync can be flagged as unsellable.

**Blocked by:** 01 (can run in parallel with 02/03).

**Status:** ready-for-agent

- [ ] A product write sets `syncStatus: "pending"` and schedules an internal sync action (Node action, since it does network I/O)
- [ ] First sync creates the Stripe Product and Price and writes back `stripeProductId` / `stripePriceId`
- [ ] Name/description changes update the Stripe Product
- [ ] A `priceCents` change creates a new Stripe Price and archives the old one (Prices are immutable)
- [ ] Deactivating a product deactivates it in Stripe
- [ ] The action writes back `syncStatus: "synced"`, or `"error"` plus a message on failure
- [ ] Seam 1 tests cover the state transitions (`pending`→`synced`, `pending`→`error`, price-change → new Price + archived old) against a mocked Stripe client, asserting observable outcomes
