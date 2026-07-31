import { v, type Infer } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./authz";
import {
  MAX_PRODUCT_IMAGES,
  MAX_PRODUCTS_LISTED,
  PRODUCT_SLUG_PATTERN,
} from "../lib/products";
import { productValidator } from "./schema";

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

// --- /admin Products (ticket 10) ------------------------------------------
//
// The catalog's only editor, and the only place stock is set by hand. Every
// function here opens with `requireAdmin` (ticket 08), reads included: raw
// stock and a sync failure are the store's business, never a shopper's — the
// storefront queries above deliberately expose neither.

const adminProductSummaryValidator = productValidator
  .pick(
    "slug",
    "name",
    "priceCents",
    "compareAtCents",
    "stock",
    "reserved",
    "active",
    "sortOrder",
    "syncStatus",
    "syncError",
  )
  .extend({
    _id: v.id("products"),
    // One thumbnail is all a row shows; the rest are the edit form's business.
    imageUrl: v.union(v.string(), v.null()),
    available: v.number(),
    lowStock: v.boolean(),
  });

/**
 * Every product, active or not, in the order the storefront lists them.
 *
 * Unlike `listActive`, this includes deactivated products — this is where a
 * seasonal item is found again and switched back on (spec story 37) — and it
 * reports the raw counts, because the person reordering stock is the one person
 * who needs them.
 */
export const listForAdmin = query({
  args: {},
  returns: v.array(adminProductSummaryValidator),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    // The whole catalog is ~5 SKUs; `by_active` only orders within one active
    // state, so the sort is done here rather than half-done by an index.
    const products = await ctx.db.query("products").take(MAX_PRODUCTS_LISTED);
    products.sort((a, b) => a.sortOrder - b.sortOrder);

    return await Promise.all(
      products.map(async (product) => {
        const available = Math.max(0, product.stock - product.reserved);
        return {
          _id: product._id,
          slug: product.slug,
          name: product.name,
          priceCents: product.priceCents,
          compareAtCents: product.compareAtCents,
          imageUrl:
            product.imageIds[0] === undefined
              ? null
              : await ctx.storage.getUrl(product.imageIds[0]),
          stock: product.stock,
          reserved: product.reserved,
          available,
          // Off *available* stock, not raw stock: units an in-flight checkout
          // is holding are not on the shelf, and a reorder decision made on the
          // raw number is made on units nobody can buy. Zero is not "low" — it
          // is out, which the screen says in its own words.
          lowStock: available > 0 && available < LOW_STOCK_THRESHOLD,
          active: product.active,
          sortOrder: product.sortOrder,
          syncStatus: product.syncStatus,
          syncError: product.syncError,
        };
      }),
    );
  },
});

const adminProductValidator = productValidator
  .omit("imageIds")
  .extend({
    _id: v.id("products"),
    _creationTime: v.number(),
    reserved: v.number(),
    available: v.number(),
    // Paired rather than two arrays: the form submits the ids back, and the
    // screen renders the urls, and a removed image has to drop from both at
    // once. `url` is null for a blob that has gone missing from storage — the
    // reference is still the form's to remove.
    images: v.array(
      v.object({
        storageId: v.id("_storage"),
        url: v.union(v.string(), v.null()),
      }),
    ),
  });

/**
 * One product, with everything the edit form owns.
 *
 * Takes the id as a string and normalizes it, for the same reason
 * `orders.get` does: the caller is a URL path segment, and a mistyped one
 * should render "no such product" rather than throw at the screen.
 */
export const getForAdmin = query({
  args: { productId: v.string() },
  returns: v.union(adminProductValidator, v.null()),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const productId = ctx.db.normalizeId("products", args.productId);
    if (productId === null) {
      return null;
    }
    const product = await ctx.db.get(productId);
    if (product === null) {
      return null;
    }
    // The raw `imageIds` are dropped; the form gets them back below, paired
    // with the signed url each one renders as.
    const { imageIds, ...fields } = product;
    return {
      ...fields,
      available: Math.max(0, product.stock - product.reserved),
      images: await Promise.all(
        imageIds.map(async (storageId) => ({
          storageId,
          url: await ctx.storage.getUrl(storageId),
        })),
      ),
    };
  },
});

// The fields Stripe mirrors (see `productParams` in `stripeSync.ts`, which puts
// the slug in the Stripe Product's metadata). A save that touches one of these
// has to re-sync; a save that touches none of them must not, or every stock
// correction would churn `syncStatus` and spend Stripe calls for nothing.
const MIRRORED_FIELDS = [
  "slug",
  "name",
  "description",
  "priceCents",
  "active",
] as const;

const SLUG_REGEX = new RegExp(`^${PRODUCT_SLUG_PATTERN}$`);

// Validation lives in the mutation, not in the form: the form is a convenience,
// and a mutation reachable over the network is where the catalog's invariants
// actually have to hold. Messages are written to be read by the owner, since
// the form shows them verbatim.
function requireCount(label: string, value: number, minimum: number): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(
      `${label} must be a whole number of at least ${minimum} (got ${value})`,
    );
  }
  return value;
}

const saveArgs = productValidator
  .pick(
    "slug",
    "name",
    "description",
    "priceCents",
    "compareAtCents",
    "imageIds",
    "stock",
    "active",
    "sortOrder",
  )
  .extend({ productId: v.id("products") });

/**
 * The edit form's save (spec stories 34, 35, 37).
 *
 * Takes the whole form every time rather than a patch of what changed: an
 * absent `compareAtCents` means "no compare-at price", which is exactly what
 * clearing the box should do. `stock` is the same shape of decision — an
 * absolute count, never a delta (story 35), because "set stock to 48" is
 * unambiguous in a way "+3" is not when the owner is holding the box.
 *
 * `reserved` is deliberately not editable: it belongs to the checkout flow, and
 * an edit that handed back units an in-flight session is holding would oversell
 * the product.
 */
export const save = mutation({
  args: saveArgs.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const product = await ctx.db.get(args.productId);
    if (product === null) {
      throw new Error("No such product");
    }

    const slug = args.slug.trim();
    if (!SLUG_REGEX.test(slug)) {
      throw new Error(
        `The slug "${slug}" isn't a URL key — use lowercase letters, numbers, and single hyphens (e.g. "cacao-crunch")`,
      );
    }
    const clash = await ctx.db
      .query("products")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (clash !== null && clash._id !== product._id) {
      throw new Error(`Another product already uses the slug "${slug}"`);
    }

    const name = args.name.trim();
    if (name === "") {
      throw new Error("Name can't be empty");
    }

    // A zero-cent bar is a giveaway, not a price — far likelier a half-typed
    // number than an intention, and Stripe would happily mirror it.
    requireCount("Price", args.priceCents, 1);
    if (args.compareAtCents !== undefined) {
      requireCount("Compare-at price", args.compareAtCents, 1);
      if (args.compareAtCents <= args.priceCents) {
        throw new Error(
          "Compare-at price must be higher than the price — it is what the strikethrough is struck through",
        );
      }
    }
    requireCount("Stock", args.stock, 0);
    if (!Number.isInteger(args.sortOrder)) {
      throw new Error(`Sort order must be a whole number (got ${args.sortOrder})`);
    }
    if (args.imageIds.length > MAX_PRODUCT_IMAGES) {
      throw new Error(`A product can hold at most ${MAX_PRODUCT_IMAGES} images`);
    }

    const fields = {
      slug,
      name,
      description: args.description.trim(),
      priceCents: args.priceCents,
      compareAtCents: args.compareAtCents,
      imageIds: args.imageIds,
      stock: args.stock,
      active: args.active,
      sortOrder: args.sortOrder,
    };
    await ctx.db.patch(product._id, fields);

    if (MIRRORED_FIELDS.some((field) => fields[field] !== product[field])) {
      await markPendingAndScheduleSync(ctx, product._id);
    }
    return null;
  },
});

/**
 * The list screen's active toggle (story 37).
 *
 * Deactivating removes the product from the storefront — `listActive` and
 * `getBySlug` both refuse it — without deleting anything, so the orders that
 * reference it keep their line snapshot and switching it back on is one click.
 * Stripe mirrors `active`, hence the re-sync.
 */
export const setActive = mutation({
  args: { productId: v.id("products"), active: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const product = await ctx.db.get(args.productId);
    if (product === null) {
      throw new Error("No such product");
    }
    if (product.active === args.active) {
      return null;
    }
    await ctx.db.patch(product._id, { active: args.active });
    await markPendingAndScheduleSync(ctx, product._id);
    return null;
  },
});

/**
 * Re-runs the mirror for a product stuck in `error` (story 36).
 *
 * A product that failed to sync cannot be sold, and nothing about it has to
 * change for the retry to be worth making — the failure may have been a bad key
 * or a Stripe outage. Without this the only way out of `error` would be a fake
 * edit.
 */
export const retrySync = mutation({
  args: { productId: v.id("products") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const product = await ctx.db.get(args.productId);
    if (product === null) {
      throw new Error("No such product");
    }
    await markPendingAndScheduleSync(ctx, product._id);
    return null;
  },
});

/**
 * A short-lived, single-use URL the browser POSTs an image straight to.
 *
 * Admin-guarded like every other write here: an ungated upload URL is a public
 * write endpoint for anyone's blob. The returned storage id comes back to the
 * form, which submits it inside `imageIds` — an upload the owner then abandons
 * leaves an unreferenced blob, which is the cheap direction to err in.
 */
export const generateImageUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.storage.generateUploadUrl();
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
