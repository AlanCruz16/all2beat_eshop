import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
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
    return await ctx.db.insert("products", {
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
export const seedProducts = action({
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
