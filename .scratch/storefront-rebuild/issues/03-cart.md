# 03 — Cart

**What to build:** A shopper can build up an order before paying: add products with a quantity, review and adjust the cart, and see the subtotal plus how much more they need for free shipping. The cart survives a page refresh, and the price shown always matches the store's current price — never a stale value baked in when the item was added.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] Add-to-cart with a chosen quantity from a product page
- [ ] Cart view (page or drawer) shows line items, quantities, and subtotal
- [ ] Quantity can be changed and items removed
- [ ] Cart state persists across refresh (client state + `localStorage`, hydration-safe)
- [ ] A free-shipping progress indicator ("$X more for free shipping") reads the threshold from `settings`
- [ ] Displayed line prices always reflect the current product price from Convex, not a value stored in the cart
- [ ] Done when: the cart survives refresh and computes totals correctly, with no payment path yet
