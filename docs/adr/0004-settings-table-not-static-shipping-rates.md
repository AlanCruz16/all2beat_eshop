# Self-service Settings via a Convex table, not static Stripe shipping_rate objects

Masterplan §5.4 and §7 contradicted each other: §5.4 has shipping rates as `shipping_rate` objects created once in the Stripe Dashboard and referenced by ID from env vars (changing the amount means creating a new Stripe object and redeploying), while §7 lists the `/admin` Settings screen as letting the Admin edit "flat shipping rate amount, free-shipping threshold" themselves. An env-var-backed value cannot be edited from a database-backed form — one of the two had to give.

We resolved this in favor of Settings actually being self-service, since that was the stated point of building the screen at all. A Convex `settings` table now holds the tax-enabled flag, shipping flat-rate cents, free-shipping-threshold cents, and store contact email, read live by `createCheckoutSession`. Shipping amounts are passed to Stripe as dynamic `shipping_options[].shipping_rate_data`, computed server-side from the table — not static pre-created `shipping_rate` object IDs. The Admin can change these numbers without touching the Stripe Dashboard or triggering a deploy.

Consequence for build sequencing: the `settings` table must be seeded with defaults (tax off, $5.00 shipping, $25.00 free-shipping threshold) early enough for the Phase 3 checkout Server Action to read it, even though the `/admin` Settings screen to edit it isn't built until Phase 4.

**Status**: accepted — supersedes masterplan §5.4's static `shipping_rate` object approach
