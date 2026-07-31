// Shared by the Convex query that enforces it and the /admin screen that has
// to admit to it, so the number the owner is told is the number they got.
//
// A ~5-SKU store doing low volume will not outrun this for a long time, and a
// bounded read keeps the list a single cheap query rather than a paginator the
// owner has to click through. When it does start truncating, the fix is
// `usePaginatedQuery`, not a bigger number.
export const MAX_ORDERS_LISTED = 200;
