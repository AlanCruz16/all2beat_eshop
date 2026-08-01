# 11 — Admin Settings screen

**What to build:** The store owner adjusts store-wide commerce settings themselves — no developer, no Stripe Dashboard trip, no redeploy (ADR-0004). Changing the shipping rate, free-shipping threshold, tax toggle, or contact email edits the `settings` row that checkout already reads live, so the next checkout reflects the change immediately.

**Blocked by:** 08.

**Status:** done

- [x] Settings screen edits the `settings` table: flat shipping rate, free-shipping threshold, tax-enabled toggle, and contact email
- [x] Changes take effect on the next checkout without a redeploy (checkout reads `settings` live, per 05)
- [x] The tax toggle defaults off and can be turned on the moment the client confirms nexus registration
- [x] The screen resists scope growth — only these four values
- [x] The write goes through a mutation that reuses the authorization helper from 08

## Comments

Implemented 2026-08-01.

- **`settings.save` is the whole write surface** (`convex/settings.ts`) — one mutation, all four values every time. It opens with `requireAdmin` (ticket 08) like every other admin write. There is deliberately no admin-only *read*: `settings.get` was already public because the contact page prints the email and the cart counts up to the threshold, so a second guarded read would guard nothing.
- **"Only these four" holds by construction, not by discipline.** The four fields moved out of `defineTable` into an exported `settingsValidator` in `schema.ts` (the same move `productValidator` made), and the mutation's args are `settingsValidator.fields`. A fifth Setting can't be added to the form without adding it to the stored shape first.
- **The save inserts when no row exists.** `reserveCart` refuses to run without a settings row, and this form is the one screen that can supply all four values — leaving it patch-only would mean a never-seeded deployment could only be fixed from a terminal. The form shows an amber "checkout will refuse to run" note in that state.
- **Zero is a real answer to both amounts**, not a missing one: a flat rate of zero and a threshold of zero both mean free shipping on every order, which is what `shippingOptionFor` in `lib/checkout.ts` already reads them as. Only negatives and fractional cents are refused.
- **Rejections travel as `ConvexError`**, so the owner reads the actual reason rather than "Server Error" (the lesson `products.ts` learned in ticket 10).
- **The live-effect claim is tested, not asserted**: `convex/settings.admin.test.ts` saves new values and then calls `checkout.reserveCart`, expecting the quote's `settings` block to carry them. That is the ADR-0004 promise in one test.
- **Nothing here touches Stripe.** The amounts reach it as per-session `shipping_rate_data` and the flag as `automatic_tax.enabled`, both built from this row at request time — which is exactly why no redeploy or Dashboard trip is involved.
- **Turning the tax toggle on still needs Stripe Tax configured** in the Stripe Dashboard (origin address, registrations). The toggle is ours; the tax engine behind it is not, and the checkbox says so.
