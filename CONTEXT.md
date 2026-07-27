# all2beat Storefront

Domain glossary for the all2beat.com rebuild — a small guest-checkout-only e-commerce storefront selling vegan snack bars, built on Next.js, Convex, Clerk, and Stripe.

## Language

**Product**:
A sellable item (one of ~5 snack bar SKUs) with a canonical price, description, and images. Convex holds the source-of-truth record; Stripe holds a mirrored Product/Price pair used only for checkout and Dashboard reporting.
_Avoid_: SKU, Item

**Stock**:
The physical, on-hand count of a Product. Never exposed directly to the storefront.
_Avoid_: Inventory

**Reserved**:
The portion of a Product's Stock held by Reservations for in-flight (not yet completed) Checkout Sessions.

**Available stock**:
`Stock − Reserved`. The only inventory figure ever surfaced to a guest, and while browsing only as a boolean or a low-stock hint, never the raw number. The single exception is a checkout the server refuses for want of stock: there the exact figure is what tells the shopper how to get unblocked ("Only 3 left of X"), so it is stated.

**Reservation**:
A time-boxed hold on Stock, created atomically when a Checkout Session starts and matching that session's `expires_at`. Ends in one of three states: `committed` (payment succeeded, Stock is decremented), `released` (session expired, cancelled, or swept), or stays `held` until one of those happens.

**Cart**:
A shopper's in-progress selection, held only in their own browser (`localStorage`) as Product slugs and quantities — never prices, and never on the server. Priced live from Products on every render, so an Admin price change takes effect immediately and a stale price can never be displayed. Holds no Reservation: nothing is held back from other shoppers until a Checkout Session starts.
_Avoid_: Basket

**Order**:
An immutable snapshot of a completed purchase — line items, prices, and shipping address exactly as they were at time of sale. Never reconstructed by joining back to the live Product table; Product names and prices change, Orders must not.

**Guest checkout**:
The store's only checkout mode. There are no customer accounts, logins, saved addresses, or order-history pages anywhere in the system — by design, not as a current gap.

**Admin**:
The single authenticated user (the store owner) who manages Products, Orders, and Settings through `/admin`. Distinct from a Customer — the two never overlap, and there is no tiering among Admins.

**Settings**:
Store-wide, Admin-editable configuration — the sales-tax-enabled flag, the flat shipping rate, the free-shipping threshold, and the store contact email. Read live by checkout at session-creation time. Not a Stripe Dashboard object and not an env var — changing Settings never requires a deploy.
_Avoid_: Config (reserve for actual env/build-time configuration, which Settings is deliberately not)

**Sync status**:
A Product's mirror state in Stripe — `pending`, `synced`, or `error`. A Product stuck in `error` cannot be sold and must be surfaced prominently in `/admin`.
