# 10 — Admin Products screen

**What to build:** The store owner keeps the catalog accurate without a developer. They see every product with its stock, active state, and Stripe sync status at a glance, edit any product's fields, set stock to an exact number, and get a prominent warning when a product failed to sync to Stripe (and therefore can't be sold). Editing a product triggers the sync engine from 04.

**Blocked by:** 08, 04.

**Status:** ready-for-agent

- [ ] Product list shows each product's stock, active status, and `syncStatus`
- [ ] Edit form covers name, slug, description, price, compare-at price, images, stock, active flag, and sort order
- [ ] Stock is edited as an absolute value ("set stock to 48"), not a delta
- [ ] Image upload writes to Convex file storage
- [ ] A low-stock highlight flags products running low
- [ ] Deactivating a product removes it from the storefront without deleting it
- [ ] A saved edit triggers the sync engine (04); a `syncStatus: "error"` is surfaced prominently as unsellable
- [ ] All writes go through mutations that reuse the authorization helper from 08
