# 02 — Catalog & storefront shell

**What to build:** A shopper can browse the whole store. The five products render on `/shop`, each has a detail page, and the marketing pages (home, about, contact) exist. Inactive products never appear, and the store's raw on-hand stock number is never exposed — only availability and a low-stock hint. No cart yet.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] A Convex product query returns only `active` products, ordered by `sortOrder`, computing available stock as `stock − reserved` and never returning raw `stock`
- [ ] A seed script populates the 5 SKUs (product data supplied first-hand by the client, ADR-0002)
- [ ] `/shop` lists all active products; `/product/[slug]` shows name, description, price, images, and stock status
- [ ] A low-stock indicator appears when availability is low; sold-out state is distinguishable
- [ ] Homepage, `/about`, and `/contact` render
- [ ] Product images are served from Convex file storage and load on mobile and desktop (`next.config` image patterns configured)
- [ ] Layout, nav, and footer are present across pages
- [ ] Seam 1 tests cover the product query: active-only filtering, availability math, and that raw stock is not exposed
- [ ] Done when: the full catalog browses correctly on mobile and desktop
