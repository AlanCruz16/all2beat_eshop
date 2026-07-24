# 12 — URL redirects & launch groundwork

**What to build:** Existing links and search-engine results keep working after the relaunch, and nothing about the site betrays its WordPress past. The known old-site paths permanently redirect to their new equivalents, and no leftover WooCommerce plugin paths or placeholder imagery are reachable.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] `next.config.ts` `redirects()` with `permanent: true` covers the known §10 path table: `/shop/`→`/shop`, each `/product/<old-slug>/`→its new slug (mapped per SKU), `/about-us/`→`/about`, `/contact-us/`→`/contact`, `/my-account/`·`/cart/`·`/checkout/`→`/`, and the WooCommerce "Our Products" page-id URL→`/shop`
- [ ] No crawl of the old site — the known table is the full redirect set (resolved during grilling)
- [ ] No old WordPress/WooCommerce plugin paths or placeholder imagery are reachable on the new site
- [ ] Redirects verified against the known-path table
