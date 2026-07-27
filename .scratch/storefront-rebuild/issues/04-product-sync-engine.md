# 04 — Convex→Stripe product sync engine

**What to build:** Products stay owned in Convex and are mirrored out to Stripe automatically, so the Stripe Dashboard is a trustworthy secondary view (ADR-0001). Any write to a product schedules a sync; the sync creates/updates the Stripe Product and Price, handles the fact that Prices are immutable, and records whether it succeeded — so a product that failed to sync can be flagged as unsellable.

**Blocked by:** 01 (can run in parallel with 02/03).

**Status:** done

- [x] A product write sets `syncStatus: "pending"` and schedules an internal sync action (Node action, since it does network I/O)
- [x] First sync creates the Stripe Product and Price and writes back `stripeProductId` / `stripePriceId`
- [x] Name/description changes update the Stripe Product
- [x] A `priceCents` change creates a new Stripe Price and archives the old one (Prices are immutable)
- [x] Deactivating a product deactivates it in Stripe
- [x] The action writes back `syncStatus: "synced"`, or `"error"` plus a message on failure
- [x] Seam 1 tests cover the state transitions (`pending`→`synced`, `pending`→`error`, price-change → new Price + archived old) against a mocked Stripe client, asserting observable outcomes

## Comments

Implemented 2026-07-27. Notes for whoever picks up ticket 10 (admin products) or 05/06:

- The sync action lives in `convex/stripeSync.ts`, not `convex/stripe.ts` as masterplan §6 sketched. `"use node"` is file-wide and cannot sit alongside queries/mutations, and the webhook (ticket 06) needs the **default** Convex runtime for `constructEventAsync` — so the Node-only mirror gets its own file and ticket 06 is free to take `convex/stripe.ts`.
- Ticket 10's admin mutation should authorize, then call `internal.products.updateMirroredFields` for name/description/price/active, and patch the Convex-only fields (stock, images, compare-at price, sort order) directly. Nothing else should set `syncStatus` by hand; if a write does need to re-sync, use the exported `markPendingAndScheduleSync` helper.
- That split is deliberate: a write that changes nothing Stripe mirrors must not flip a `synced` product to `pending` and spend Stripe calls that change nothing. Same reason ticket 06's stock decrement should patch `stock`/`reserved` directly.
- `STRIPE_SECRET_KEY` is declared in the new `convex/convex.config.ts` and read via the typed `env` object from `_generated/server` (per `convex/_generated/ai/guidelines.md`), not `process.env`. It's declared optional so an unset key surfaces as a per-product sync error rather than a deployment that won't start.
- Price ordering is load-bearing: create the new Price → point the Product's `default_price` at it → archive the old one. Stripe refuses to archive a Product's default Price, so the reverse order fails in production but not against a mock; a test pins the ordering.
- A sync that creates the Stripe Product and then fails still writes back the `stripeProductId` (see `products.recordSyncError`), so a retry updates that Product instead of creating a duplicate.
- `STRIPE_SECRET_KEY` must be set on both Convex deployments (`npx convex env set STRIPE_SECRET_KEY sk_... [--prod]`) — the `.env.local`/Vercel copy only covers the Next.js side. Noted in `.env.example`. Without it the sync records `syncStatus: "error"` with a message saying so, rather than failing silently.
- `products.insertSeedProduct` now schedules a sync too, so `npm run seed` produces sellable products. Re-seeding an already-seeded deployment is still a no-op.
- Reviewed on both axes (`/code-review`). Applied: scope-trimmed the write mutation to the mirrored fields (the full admin edit shape belongs to ticket 10), moved to typed Convex env, dropped a call-ordering assertion in favour of the observable outcome, and tightened comments. Left as-is deliberately: the extra `prices.retrieve` per sync, since Convex keeps no record of what Stripe currently charges — it's how "did the price change?" is answered, and it also catches a Price archived by hand in the Dashboard.
