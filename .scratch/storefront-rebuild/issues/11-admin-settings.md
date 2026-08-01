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

Code review (two-axis) found no spec gaps and no documented-standard breaches. What it did find was duplication, now folded away:

- `Field` and `INPUT_CLASS` moved into `app/admin/(shell)/adminForm.tsx` — the file that exists to hold exactly this, and Settings was the second screen to need them. `signatureOf` moved there too, beside the `useServerBackedState` hook whose concept it is.
- `reject` and `requireCount` moved into `convex/adminInput.ts`, shared by Products and Settings. The three lines were never the point; the reasoning above them (why a `ConvexError` and not an `Error`) is what shouldn't be re-derived per screen.

Two findings were checked and rejected:

- **"The contact page needs a redeploy to show a new email."** It doesn't — `/contact` isn't in the prerender manifest and Next builds it as `ƒ` (server-rendered on demand), so `fetchQuery(api.settings.get)` re-reads the row each request. Verified against `.next/prerender-manifest.json`, not inferred.
- **"`ShippingSummary` restates the threshold-≤-0 rule that `lib/checkout.ts` owns."** True, and left alone: that rule already lives in `shippingOptionFor`, `freeShippingProgress`, and `FreeShippingProgress`, so unifying it is a change to the checkout math seam and its tests — not this ticket's business.

### Turning the tax toggle on (Stripe Dashboard)

The toggle is ours; the tax engine behind it is not. Nothing in the code has to change to flip it — verified while writing this, not assumed:

- `automatic_tax: { enabled: settings.taxEnabled }` is wired from the row (`lib/checkout.ts`), so `/admin` genuinely controls it.
- Tax needs a customer address, and checkout already collects one (`shipping_address_collection: { allowed_countries: ["US"] }`).
- Orders already record what Stripe calculates — `taxCents: session.total_details?.amount_tax ?? 0` (`convex/http.ts`). Tax lands on orders the moment it's on.
- Shipping sets `tax_behavior: "exclusive"` explicitly; Stripe's preset shipping tax code covers the rest.

Dashboard steps, under Settings → Tax. **Do them in test mode first — it is a separate configuration from live:**

1. **Head office address** — the Arizona address (the origin masterplan §8.1 refers to). Tax won't activate without it.
2. **Default product tax code** — our Prices carry no `tax_code`, so every bar uses this one. Food is the fiddly case: prepared vs. grocery food are taxed differently by state, so this is an accountant's pick, not a sensible-looking default.
3. **Default tax behavior** — see the decision below.
4. **Registrations** (`/tax/locations`) — add Arizona. This is the step the toggle has been waiting on. Without a registration in the customer's state, Tax calculates **zero** rather than erroring, so a checkout that "works" proves nothing until this exists.
5. No Dashboard integration toggle is needed for Checkout Sessions — the API flag is what enables it, and we already send it.

**The decision that actually matters.** §8.1 records tax as currently *absorbed into the price*, so step 3 decides who absorbs it: **exclusive** adds tax on top (a $4.99 bar rings up at ~$5.44 — margin preserved, customer pays more), **inclusive** carves it out of the $4.99 (shelf price unchanged, revenue per bar drops). "Absorbed into price" describes inclusive, so choosing exclusive is a real price increase and not a config detail.

`stripeSync.ts` creates Prices without `tax_behavior`, so they inherit whichever account default is set — convenient, in that switching needs no re-mirroring, but set that default *explicitly* rather than leaving it on "Automatic", where behavior is inferred from currency. A Price that does carry a behavior is immutable, so per-product control later means create-new-Price — the same path a price change already takes.

**Order of operations:** configure test mode → test checkout with an Arizona address, confirm tax appears and reaches `taxCents` on the order → repeat in live mode → *then* flip the toggle in `/admin`. The toggle is last, and it is the only step that isn't a Dashboard trip.

Two things worth watching: §8.1 names Arizona, but shipping enough volume into other states can trigger economic nexus there too — `/tax/transactions` monitors that and says where registration may be needed. And Stripe calculates and collects; **filing and remitting is separate** (Stripe Tax's filing product, or the accountant). Masterplan §9's launch checklist already carries the "Stripe Tax configured (or explicitly declined in writing)" line this satisfies.
