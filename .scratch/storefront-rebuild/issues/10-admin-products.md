# 10 — Admin Products screen

**What to build:** The store owner keeps the catalog accurate without a developer. They see every product with its stock, active state, and Stripe sync status at a glance, edit any product's fields, set stock to an exact number, and get a prominent warning when a product failed to sync to Stripe (and therefore can't be sold). Editing a product triggers the sync engine from 04.

**Blocked by:** 08, 04.

**Status:** done

- [x] Product list shows each product's stock, active status, and `syncStatus`
- [x] Edit form covers name, slug, description, price, compare-at price, images, stock, active flag, and sort order
- [x] Stock is edited as an absolute value ("set stock to 48"), not a delta
- [x] Image upload writes to Convex file storage
- [x] A low-stock highlight flags products running low
- [x] Deactivating a product removes it from the storefront without deleting it
- [x] A saved edit triggers the sync engine (04); a `syncStatus: "error"` is surfaced prominently as unsellable
- [x] All writes go through mutations that reuse the authorization helper from 08

## Comments

**Implementation notes:**

- `/admin/products` lists every product (active and not) with a thumbnail, price,
  available stock, active state, and sync badge; `/admin/products/<id>` is the
  edit form. Reads are behind `requireAdmin` too, not just writes — raw stock and
  a sync failure are the store's business, not a shopper's.
- The low-stock highlight is computed off *available* stock (`stock − reserved`)
  against the storefront's own `LOW_STOCK_THRESHOLD`, so the owner and the
  shopper are looking at the same number. Zero is reported as "Out of stock"
  rather than as "low".
- A save re-syncs only when a field Stripe actually mirrors changed (slug, name,
  description, price, active). Stock, images, compare-at price, and sort order
  are Convex's alone, so editing them no longer churns `syncStatus` or spends a
  Stripe call — the constraint `products.ts` had already written down for this
  ticket. `retrySync` covers the one case that leaves: a product stuck in
  `error` whose cause was a bad key or an outage, with nothing to re-edit.
- `products.updateMirroredFields` (ticket 04's stand-in for this form) is gone;
  the two `stripeSync` tests that drove it now drive `products.save` as /admin
  does, so the sync engine is tested against its real trigger.
- Images upload straight to Convex storage from the browser via a guarded
  `generateImageUploadUrl`, and attach on save. Removing one drops the reference
  and leaves the blob: cheap, and a delete would break any page still holding
  the old signed URL.
