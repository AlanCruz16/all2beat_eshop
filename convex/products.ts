import { v, type Infer } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

// Below this many units available, the storefront shows a low-stock hint
// instead of a plain in-stock state. Raw stock is never surfaced (§4).
export const LOW_STOCK_THRESHOLD = 5;

export const availabilityValidator = v.union(
  v.literal("in-stock"),
  v.literal("low-stock"),
  v.literal("sold-out"),
);
export type Availability = "in-stock" | "low-stock" | "sold-out";

const productSummaryValidator = v.object({
  _id: v.id("products"),
  slug: v.string(),
  name: v.string(),
  description: v.string(),
  priceCents: v.number(),
  compareAtCents: v.optional(v.number()),
  imageUrls: v.array(v.string()),
  available: v.number(),
  availability: availabilityValidator,
});

async function toProductSummary(ctx: QueryCtx, product: Doc<"products">) {
  const imageUrls = (
    await Promise.all(product.imageIds.map((id) => ctx.storage.getUrl(id)))
  ).filter((url): url is string => url !== null);
  const available = Math.max(0, product.stock - product.reserved);
  const availability =
    available === 0
      ? "sold-out"
      : available < LOW_STOCK_THRESHOLD
        ? "low-stock"
        : "in-stock";

  return {
    _id: product._id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    priceCents: product.priceCents,
    compareAtCents: product.compareAtCents,
    imageUrls,
    available,
    availability,
  } as const;
}

// Storefront catalog listing — active products only, ordered by sortOrder.
// Never returns the raw `stock`/`reserved` fields, only the computed
// available-stock hint (CONTEXT.md "Available stock").
export const listActive = query({
  args: {},
  returns: v.array(productSummaryValidator),
  handler: async (ctx) => {
    const products = await ctx.db
      .query("products")
      .withIndex("by_active", (q) => q.eq("active", true))
      .take(100);
    return await Promise.all(products.map((p) => toProductSummary(ctx, p)));
  },
});

// Single product detail lookup by slug. Returns null for inactive or
// unknown slugs so /product/[slug] can 404.
export const getBySlug = query({
  args: { slug: v.string() },
  returns: v.union(productSummaryValidator, v.null()),
  handler: async (ctx, args) => {
    const product = await ctx.db
      .query("products")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (product === null || !product.active) {
      return null;
    }
    return await toProductSummary(ctx, product);
  },
});

// Upper bound on how many distinct products one cart can ask about, so a
// hand-edited localStorage cart can't turn one query into unbounded reads.
export const MAX_CART_SLUGS = 50;

// Live pricing for the slugs a cart is holding. The cart stores slugs and
// quantities only (masterplan §5.1), so this is what every figure the shopper
// sees is computed from — a price edited in /admin takes effect immediately,
// and a stale price can never be displayed. Unknown or inactive slugs are
// simply absent from the result; the cart UI surfaces those as unavailable.
export const listBySlugs = query({
  args: { slugs: v.array(v.string()) },
  returns: v.array(productSummaryValidator),
  handler: async (ctx, args) => {
    const slugs = [...new Set(args.slugs)].slice(0, MAX_CART_SLUGS);
    const products = await Promise.all(
      slugs.map((slug) =>
        ctx.db
          .query("products")
          .withIndex("by_slug", (q) => q.eq("slug", slug))
          .unique(),
      ),
    );
    return await Promise.all(
      products
        .filter((p): p is Doc<"products"> => p !== null && p.active)
        .map((p) => toProductSummary(ctx, p)),
    );
  },
});

export const getIdBySlug = internalQuery({
  args: { slug: v.string() },
  returns: v.union(v.id("products"), v.null()),
  handler: async (ctx, args) => {
    const product = await ctx.db
      .query("products")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    return product?._id ?? null;
  },
});

// --- Stripe mirror (ADR-0001, masterplan §6) ------------------------------
//
// Convex owns the Product; Stripe holds a mirrored Product/Price pair. Every
// write that can change what Stripe should show goes through
// `markPendingAndScheduleSync`, so a doc is never left claiming to be
// `synced` when the mirror has moved on.

// The slice of a product the sync action needs. Deliberately narrower than
// `Doc<"products">`: stock, reserved, and images are Convex-only concerns and
// are never mirrored.
const productSyncViewValidator = v.object({
  _id: v.id("products"),
  slug: v.string(),
  name: v.string(),
  description: v.string(),
  priceCents: v.number(),
  active: v.boolean(),
  stripeProductId: v.optional(v.string()),
  stripePriceId: v.optional(v.string()),
});
export type ProductSyncView = Infer<typeof productSyncViewValidator>;

export const getForSync = internalQuery({
  args: { productId: v.id("products") },
  returns: v.union(productSyncViewValidator, v.null()),
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.productId);
    if (product === null) {
      return null;
    }
    return {
      _id: product._id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      priceCents: product.priceCents,
      active: product.active,
      stripeProductId: product.stripeProductId,
      stripePriceId: product.stripePriceId,
    };
  },
});

export const recordSyncSuccess = internalMutation({
  args: {
    productId: v.id("products"),
    stripeProductId: v.string(),
    stripePriceId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.productId, {
      stripeProductId: args.stripeProductId,
      stripePriceId: args.stripePriceId,
      syncStatus: "synced",
      syncError: undefined,
    });
    return null;
  },
});

// Failure still persists whatever Stripe ids the action managed to learn. A
// sync that created the Stripe Product and then failed on the Price has to
// keep that id — dropping it would leave the Product orphaned in Stripe and
// have the next attempt create a duplicate.
export const recordSyncError = internalMutation({
  args: {
    productId: v.id("products"),
    message: v.string(),
    stripeProductId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.productId, {
      syncStatus: "error",
      syncError: args.message,
      ...(args.stripeProductId === undefined
        ? {}
        : { stripeProductId: args.stripeProductId }),
      ...(args.stripePriceId === undefined
        ? {}
        : { stripePriceId: args.stripePriceId }),
    });
    return null;
  },
});

// The one way a product write announces itself to the mirror. Callers patch
// the doc, then call this — never the other way round.
export async function markPendingAndScheduleSync(
  ctx: MutationCtx,
  productId: Id<"products">,
) {
  await ctx.db.patch(productId, {
    syncStatus: "pending",
    syncError: undefined,
  });
  await ctx.scheduler.runAfter(0, internal.stripeSync.syncProduct, {
    productId,
  });
}

// Writes the mirrored fields — the ones a change to which Stripe has to hear
// about — and re-syncs. Ticket 10's admin form wraps this with the
// authorization check (this mutation is internal precisely so it can't be
// called without one) and adds the Convex-only fields: stock, images,
// compare-at price, sort order. Those must NOT come through here — nothing
// Stripe mirrors changes, so re-syncing on them would churn `syncStatus` and
// spend Stripe calls for nothing. Same reason the webhook's stock decrement
// (ticket 06) patches `stock`/`reserved` directly.
export const updateMirroredFields = internalMutation({
  args: {
    productId: v.id("products"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    priceCents: v.optional(v.number()),
    active: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { productId, ...fields } = args;
    await ctx.db.patch(productId, fields);
    await markPendingAndScheduleSync(ctx, productId);
    return null;
  },
});

export const insertSeedProduct = internalMutation({
  args: {
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    priceCents: v.number(),
    stock: v.number(),
    sortOrder: v.number(),
    imageId: v.id("_storage"),
  },
  returns: v.id("products"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("products")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing !== null) {
      return existing._id;
    }
    const productId = await ctx.db.insert("products", {
      slug: args.slug,
      name: args.name,
      description: args.description,
      priceCents: args.priceCents,
      imageIds: [args.imageId],
      stock: args.stock,
      reserved: 0,
      active: true,
      sortOrder: args.sortOrder,
      syncStatus: "pending",
    });
    // A seeded product is a product write like any other: it isn't sellable
    // until it exists in Stripe.
    await markPendingAndScheduleSync(ctx, productId);
    return productId;
  },
});

// Placeholder — real photography lands from the client before launch (ADR-0002).
// A 1x1 PNG is enough to prove the Convex-storage → next/image pipeline works.
// Placeholder copy, pricing, and photography — real client-supplied product
// data lands before launch (ADR-0002). Each SKU gets its own solid-color 8x8
// PNG (distinct per product, not just a black square) so it's visually
// obvious an image loaded through Convex storage rather than looking empty.
const SEED_PRODUCTS: Array<{
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  stock: number;
  sortOrder: number;
  placeholderImageBase64: string;
}> = [
  {
    slug: "cacao-crunch",
    name: "Cacao Crunch",
    description: "Dark cacao, toasted oats, and puffed quinoa.",
    priceCents: 499,
    stock: 40,
    sortOrder: 0,
    placeholderImageBase64:
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGOIMRbHihiGlgQASPgpgeO1TpwAAAAASUVORK5CYII=",
  },
  {
    slug: "almond-fig",
    name: "Almond Fig",
    description: "Roasted almonds and dried mission figs.",
    priceCents: 499,
    stock: 40,
    sortOrder: 1,
    placeholderImageBase64:
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGM4MisHK2IYWhIA01xygXelHwYAAAAASUVORK5CYII=",
  },
  {
    slug: "peanut-butter-oat",
    name: "Peanut Butter Oat",
    description: "Creamy peanut butter with rolled oats and flax.",
    priceCents: 499,
    stock: 40,
    sortOrder: 2,
    placeholderImageBase64:
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGPYUGWDFTEMLQkAFdVZgUa2soMAAAAASUVORK5CYII=",
  },
  {
    slug: "coconut-cashew",
    name: "Coconut Cashew",
    description: "Toasted coconut, cashews, and a hint of sea salt.",
    priceCents: 499,
    stock: 40,
    sortOrder: 3,
    placeholderImageBase64:
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGN4dm0rVsQwtCQAGZucQfFfO+gAAAAASUVORK5CYII=",
  },
  {
    slug: "mixed-berry",
    name: "Mixed Berry",
    description: "Dried strawberries, blueberries, and chia.",
    priceCents: 499,
    stock: 40,
    sortOrder: 4,
    placeholderImageBase64:
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGOYreeFFTEMLQkA8Y5EwY6wfREAAAAASUVORK5CYII=",
  },
];

// Idempotent: skips any SKU whose slug already exists, so this is safe to
// re-run against the same deployment. `ctx.storage.store` requires an
// action, hence this isn't an internalMutation like settings.seedDefaults.
//
// Internal, not public: it writes products and stores blobs, and the only
// caller is `npm run seed` — which reaches internal functions fine, because
// `convex run` authenticates with deployment credentials. A public version
// would let anyone holding the deployment URL resurrect seed SKUs.
export const seedProducts = internalAction({
  args: {},
  returns: v.array(v.id("products")),
  handler: async (ctx) => {
    const ids: Id<"products">[] = [];
    for (const { placeholderImageBase64, ...product } of SEED_PRODUCTS) {
      const existingId: Id<"products"> | null = await ctx.runQuery(
        internal.products.getIdBySlug,
        { slug: product.slug },
      );
      if (existingId !== null) {
        ids.push(existingId);
        continue;
      }
      const bytes = Uint8Array.from(atob(placeholderImageBase64), (c) =>
        c.charCodeAt(0),
      );
      const imageId = await ctx.storage.store(
        new Blob([bytes], { type: "image/png" }),
      );
      const id: Id<"products"> = await ctx.runMutation(
        internal.products.insertSeedProduct,
        { ...product, imageId },
      );
      ids.push(id);
    }
    return ids;
  },
});
