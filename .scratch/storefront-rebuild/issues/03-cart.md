# 03 — Cart

**What to build:** A shopper can build up an order before paying: add products with a quantity, review and adjust the cart, and see the subtotal plus how much more they need for free shipping. The cart survives a page refresh, and the price shown always matches the store's current price — never a stale value baked in when the item was added.

**Blocked by:** 02.

**Status:** done

- [x] Add-to-cart with a chosen quantity from a product page
- [x] Cart view (page or drawer) shows line items, quantities, and subtotal
- [x] Quantity can be changed and items removed
- [x] Cart state persists across refresh (client state + `localStorage`, hydration-safe)
- [x] A free-shipping progress indicator ("$X more for free shipping") reads the threshold from `settings`
- [x] Displayed line prices always reflect the current product price from Convex, not a value stored in the cart
- [x] Done when: the cart survives refresh and computes totals correctly, with no payment path yet

## Comments

Implemented 2026-07-27. Notes for whoever picks up ticket 05 (checkout) or later:

- **The cart never holds a price.** `localStorage` stores `[{slug, qty}]` and nothing else — verified in the browser, and `parseStoredCart` actively drops any `priceCents` found in stored JSON, so a hand-edited or legacy entry can't smuggle one in. Every figure the shopper sees comes from `products.listBySlugs`, a live Convex subscription. This is the same `[{slug, qty}]` shape masterplan §5.1 says the client may send to `createCheckoutSession`, so ticket 05 can pass `useCart().lines` almost straight through.
- `convex/products.ts` gained `listBySlugs` (active-only, de-duplicated, capped at `MAX_CART_SLUGS = 50` so a hand-edited cart can't cause unbounded reads). It returns the same `productSummaryValidator` shape as `listActive`/`getBySlug`.
- **`lib/cart.ts` is the whole cart domain, and it's pure** — `addLine`/`setLineQty`/`removeLine`, tolerant `parseStoredCart`, `priceCart` (joins lines to live catalog rows, reports `unavailable` slugs, sums the subtotal), and `freeShippingProgress`. No React, no storage, no Convex, so it's covered by ordinary unit tests (28 of them). Reuse `priceCart` for the checkout summary rather than re-deriving totals.
- **`lib/cart-storage.ts` models `localStorage` as an external store** read via `useSyncExternalStore`, not `useState` + a mount effect. The server snapshot is always `{lines: [], hydrated: false}`, so server and client markup agree by construction and React swaps in the stored cart after hydration — this is why there's no hydration flash and no `set-state-in-effect` lint violation. It also syncs across tabs via the `storage` event. Consumers read `hydrated` and show a loading state until it's true.
- **Stock is deliberately not enforced in the cart.** Add-to-cart only disables on `sold-out`; there's no "only N left" check. Two reasons: available stock must never reach a guest as a raw number (CONTEXT.md), and masterplan §5.1 step 3 puts the authoritative check inside the checkout mutation, against live stock, returning a structured error. Ticket 05 owns that message — don't add a second, staler copy of the rule to the cart.
- A `Cart` entry was added to `CONTEXT.md`, since the glossary had no term for it.
- The `Checkout` button on `/cart` is deliberately rendered disabled with a "not available yet" caption — that's the seam ticket 05 fills in.
- Code review (Standards + Spec) caught, and this commit fixes: a raw available-stock count leaking into the cart UI ("Only 3 left"), a divide-by-zero in the free-shipping bar when an Admin sets the threshold to 0, a shared `storage` listener being torn down while another subscriber was still mounted, and an unavailable-line row that didn't say *which* item had gone.
- Known minor gap, deliberately left: the nav badge counts every stored line, including ones whose product has since been deactivated (so the badge can read 3 while the subtotal covers 2). Fixing it would mean running the catalog query in the nav on every page for a rare case.
