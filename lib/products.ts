// Shared by the Convex mutation that enforces these rules and the /admin form
// that has to state them, so the box the owner types into and the check that
// rejects it can never drift apart.

// A slug is a URL key and the storefront's only product lookup, so it is
// restricted to what reads unambiguously in a path: lowercase, digits, single
// hyphens between them. As a string rather than a `RegExp` because HTML's
// `pattern=` attribute wants source without delimiters; `convex/products.ts`
// compiles it.
export const PRODUCT_SLUG_PATTERN = "[a-z0-9]+(?:-[a-z0-9]+)*";

// The /admin list is a single bounded read rather than a paginator: the catalog
// is ~5 SKUs and the owner wants the whole thing on one screen. The bound is
// here so a runaway table can't turn this into an unbounded query — the same
// reasoning as `MAX_ORDERS_LISTED`.
export const MAX_PRODUCTS_LISTED = 200;

// A snack bar needs a handful of photos, not a gallery. The cap is here to keep
// one hand-driven form from turning the catalog query into an unbounded number
// of signed-URL lookups.
export const MAX_PRODUCT_IMAGES = 8;
