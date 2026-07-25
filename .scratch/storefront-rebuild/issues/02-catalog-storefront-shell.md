# 02 — Catalog & storefront shell

**What to build:** A shopper can browse the whole store. The five products render on `/shop`, each has a detail page, and the marketing pages (home, about, contact) exist. Inactive products never appear, and the store's raw on-hand stock number is never exposed — only availability and a low-stock hint. No cart yet.

**Blocked by:** 01.

**Status:** done

- [x] A Convex product query returns only `active` products, ordered by `sortOrder`, computing available stock as `stock − reserved` and never returning raw `stock`
- [x] A seed script populates the 5 SKUs (product data supplied first-hand by the client, ADR-0002)
- [x] `/shop` lists all active products; `/product/[slug]` shows name, description, price, images, and stock status
- [x] A low-stock indicator appears when availability is low; sold-out state is distinguishable
- [x] Homepage, `/about`, and `/contact` render
- [x] Product images are served from Convex file storage and load on mobile and desktop (`next.config` image patterns configured)
- [x] Layout, nav, and footer are present across pages
- [x] Seam 1 tests cover the product query: active-only filtering, availability math, and that raw stock is not exposed
- [x] Done when: the full catalog browses correctly on mobile and desktop

## Comments

Implemented 2026-07-24. Notes for whoever picks up ticket 03 (cart) or later:

- `convex/products.ts` exports `listActive` and `getBySlug` — both return a `productSummaryValidator`-shaped object (`_id`, `slug`, `name`, `description`, `priceCents`, `compareAtCents?`, `imageUrls`, `available`, `availability`). `stock`/`reserved` never leave the module. `LOW_STOCK_THRESHOLD = 5` (available < 5 → `"low-stock"`, `0` → `"sold-out"`) and the `Availability` type/`availabilityValidator` are exported from there so the frontend (`StockBadge`, `ProductCard`) shares one definition instead of redeclaring the union.
- **Seed data is placeholder, not real client content.** `SEED_PRODUCTS` in `convex/products.ts` has 5 invented SKUs (Cacao Crunch, Almond Fig, Peanut Butter Oat, Coconut Cashew, Mixed Berry) at a flat $4.99, and every seeded product gets the same inline 1×1 PNG as its image — real names/descriptions/pricing/photography from the client (ADR-0002) still need to replace this before launch. The seed proves the Convex-storage → `next/image` pipeline works, nothing more. Reproducible via `npm run seed` (runs `settings:seedDefaults` then `products:seedProducts`; both are idempotent, safe to re-run). `products:seedProducts` is an `action` (not `internalMutation` like the settings seed) because `ctx.storage.store` is action-only.
- `next.config.ts` now allows `next/image` to load from `*.convex.cloud/api/storage/**` — needed for any future image work (admin product uploads, etc.) to keep working through the same pattern.
- Nav/Footer are wired once, in `app/layout.tsx`, so every route gets them for free — no per-page layout duplication needed.
- Code review (Standards + Spec axes) surfaced fixes applied before commit: a missing `ctx.runQuery` type annotation (Convex guideline on same-file circularity), the `Availability` union was declared three times independently — now single-sourced from `convex/products.ts` — and an unused `sortOrder` field was dropped from the public query return shape (sorting is already server-side via the index). The homepage was also updated to link into `/shop` instead of leaving ticket 01's placeholder "read a settings row" text as the whole storefront entry point.
