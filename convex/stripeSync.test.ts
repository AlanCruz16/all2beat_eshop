/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

// Seam 1 (spec "Testing Decisions"): the Convex function boundary with the
// Stripe SDK mocked. Whether our parameter shapes are actually valid Stripe
// calls is Seam 2's job — here we only assert observable outcomes: the
// products row after the sync, and which Stripe objects were created/archived.
const stripe = vi.hoisted(() => ({
  products: { create: vi.fn(), update: vi.fn() },
  prices: { create: vi.fn(), update: vi.fn(), retrieve: vi.fn() },
}));

// `new Stripe(key)` returns the mock — a constructor returning an object
// overrides `this`, which an arrow function cannot do.
vi.mock("stripe", () => ({
  default: function () {
    return stripe;
  },
}));

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  stripe.products.create.mockResolvedValue({ id: "prod_new" });
  stripe.products.update.mockResolvedValue({ id: "prod_existing" });
  stripe.prices.create.mockResolvedValue({ id: "price_new" });
  stripe.prices.update.mockResolvedValue({ id: "price_old", active: false });
  stripe.prices.retrieve.mockResolvedValue({
    id: "price_old",
    active: true,
    currency: "usd",
    unit_amount: 499,
  });
});

type ProductOverrides = Partial<Doc<"products">>;

async function insertProduct(
  t: ReturnType<typeof convexTest>,
  overrides: ProductOverrides = {},
): Promise<Id<"products">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("products", {
      slug: "cacao-crunch",
      name: "Cacao Crunch",
      description: "Dark cacao and toasted oats.",
      priceCents: 499,
      imageIds: [],
      stock: 10,
      reserved: 0,
      active: true,
      sortOrder: 0,
      syncStatus: "pending",
      ...overrides,
    });
  });
}

async function readProduct(
  t: ReturnType<typeof convexTest>,
  productId: Id<"products">,
) {
  return await t.run(async (ctx) => await ctx.db.get(productId));
}

test("first sync creates the Stripe Product and Price and writes back both ids", async () => {
  const t = convexTest(schema, modules);
  const productId = await insertProduct(t);

  await t.action(internal.stripeSync.syncProduct, { productId });

  expect(stripe.products.create).toHaveBeenCalledTimes(1);
  expect(stripe.prices.create).toHaveBeenCalledWith(
    expect.objectContaining({
      product: "prod_new",
      currency: "usd",
      unit_amount: 499,
    }),
  );
  expect(await readProduct(t, productId)).toMatchObject({
    stripeProductId: "prod_new",
    stripePriceId: "price_new",
    syncStatus: "synced",
  });
});

test("a name or description change updates the Stripe Product without a new Price", async () => {
  const t = convexTest(schema, modules);
  const productId = await insertProduct(t, {
    name: "Cacao Crunch (New Recipe)",
    stripeProductId: "prod_existing",
    stripePriceId: "price_old",
  });

  await t.action(internal.stripeSync.syncProduct, { productId });

  expect(stripe.products.update).toHaveBeenCalledWith(
    "prod_existing",
    expect.objectContaining({ name: "Cacao Crunch (New Recipe)" }),
  );
  expect(stripe.prices.create).not.toHaveBeenCalled();
  expect(stripe.prices.update).not.toHaveBeenCalled();
  expect(await readProduct(t, productId)).toMatchObject({
    stripePriceId: "price_old",
    syncStatus: "synced",
  });
});

test("a priceCents change creates a new Price and archives the old one", async () => {
  const t = convexTest(schema, modules);
  const productId = await insertProduct(t, {
    priceCents: 599,
    stripeProductId: "prod_existing",
    stripePriceId: "price_old",
  });

  await t.action(internal.stripeSync.syncProduct, { productId });

  expect(stripe.prices.create).toHaveBeenCalledWith(
    expect.objectContaining({ product: "prod_existing", unit_amount: 599 }),
  );
  expect(stripe.prices.update).toHaveBeenCalledWith("price_old", {
    active: false,
  });
  // The Product has to end up pointing at the new Price — Stripe refuses to
  // archive a Product's default Price, so the old one could not have been
  // archived otherwise.
  expect(stripe.products.update).toHaveBeenCalledWith("prod_existing", {
    default_price: "price_new",
  });
  expect(await readProduct(t, productId)).toMatchObject({
    stripePriceId: "price_new",
    syncStatus: "synced",
  });
});

test("deactivating a product deactivates it in Stripe", async () => {
  const t = convexTest(schema, modules);
  const productId = await insertProduct(t, {
    active: false,
    stripeProductId: "prod_existing",
    stripePriceId: "price_old",
  });

  await t.action(internal.stripeSync.syncProduct, { productId });

  expect(stripe.products.update).toHaveBeenCalledWith(
    "prod_existing",
    expect.objectContaining({ active: false }),
  );
  expect(await readProduct(t, productId)).toMatchObject({
    syncStatus: "synced",
  });
});

test("a Stripe failure leaves the product in error with the message", async () => {
  const t = convexTest(schema, modules);
  stripe.products.create.mockRejectedValue(new Error("Invalid API Key"));
  const productId = await insertProduct(t);

  await t.action(internal.stripeSync.syncProduct, { productId });

  expect(await readProduct(t, productId)).toMatchObject({
    syncStatus: "error",
    syncError: "Invalid API Key",
  });
});

test("a missing STRIPE_SECRET_KEY is reported as a sync error, not a crash", async () => {
  const t = convexTest(schema, modules);
  delete process.env.STRIPE_SECRET_KEY;
  const productId = await insertProduct(t);

  await t.action(internal.stripeSync.syncProduct, { productId });

  const product = await readProduct(t, productId);
  expect(product?.syncStatus).toBe("error");
  expect(product?.syncError).toContain("STRIPE_SECRET_KEY");
});

test("a half-finished sync keeps the Stripe Product id so a retry cannot duplicate it", async () => {
  const t = convexTest(schema, modules);
  stripe.prices.create.mockRejectedValue(new Error("Price creation failed"));
  const productId = await insertProduct(t);

  await t.action(internal.stripeSync.syncProduct, { productId });

  expect(await readProduct(t, productId)).toMatchObject({
    stripeProductId: "prod_new",
    syncStatus: "error",
  });

  stripe.prices.create.mockResolvedValue({ id: "price_new" });
  await t.action(internal.stripeSync.syncProduct, { productId });

  expect(stripe.products.create).toHaveBeenCalledTimes(1);
  expect(await readProduct(t, productId)).toMatchObject({
    stripeProductId: "prod_new",
    stripePriceId: "price_new",
    syncStatus: "synced",
  });
});

test("a re-sync with an unchanged price reuses the existing Price", async () => {
  const t = convexTest(schema, modules);
  const productId = await insertProduct(t, {
    stripeProductId: "prod_existing",
    stripePriceId: "price_old",
    syncStatus: "synced",
  });

  await t.action(internal.stripeSync.syncProduct, { productId });

  expect(stripe.prices.create).not.toHaveBeenCalled();
  expect(await readProduct(t, productId)).toMatchObject({
    stripePriceId: "price_old",
    syncStatus: "synced",
  });
});

test("an archived Stripe Price is replaced even when the amount still matches", async () => {
  const t = convexTest(schema, modules);
  stripe.prices.retrieve.mockResolvedValue({
    id: "price_old",
    active: false,
    currency: "usd",
    unit_amount: 499,
  });
  const productId = await insertProduct(t, {
    stripeProductId: "prod_existing",
    stripePriceId: "price_old",
  });

  await t.action(internal.stripeSync.syncProduct, { productId });

  expect(stripe.prices.create).toHaveBeenCalledTimes(1);
  expect(await readProduct(t, productId)).toMatchObject({
    stripePriceId: "price_new",
    syncStatus: "synced",
  });
});

test("syncing a deleted product is a no-op", async () => {
  const t = convexTest(schema, modules);
  const productId = await insertProduct(t);
  await t.run(async (ctx) => await ctx.db.delete(productId));

  await t.action(internal.stripeSync.syncProduct, { productId });

  expect(stripe.products.create).not.toHaveBeenCalled();
});

test("a product write marks it pending and schedules the sync to completion", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const productId = await insertProduct(t, {
    stripeProductId: "prod_existing",
    stripePriceId: "price_old",
    syncStatus: "synced",
  });

  await t.mutation(internal.products.updateMirroredFields, {
    productId,
    priceCents: 599,
  });

  expect(await readProduct(t, productId)).toMatchObject({
    priceCents: 599,
    syncStatus: "pending",
  });

  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(await readProduct(t, productId)).toMatchObject({
    stripePriceId: "price_new",
    syncStatus: "synced",
  });
});

test("a product write clears a stale sync error before re-syncing", async () => {
  const t = convexTest(schema, modules);
  const productId = await insertProduct(t, {
    stripeProductId: "prod_existing",
    stripePriceId: "price_old",
    syncStatus: "error",
    syncError: "Invalid API Key",
  });

  await t.mutation(internal.products.updateMirroredFields, {
    productId,
    name: "Renamed",
  });

  const pending = await readProduct(t, productId);
  expect(pending?.syncStatus).toBe("pending");
  expect(pending?.syncError).toBeUndefined();
});
