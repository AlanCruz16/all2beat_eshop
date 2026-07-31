/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { LOW_STOCK_THRESHOLD } from "./products";

// Seam 1 (spec "Testing Decisions"): the /admin Products read and write paths —
// what the list carries, what an edit writes, and which edits the Stripe mirror
// has to hear about. The authorization guarantee itself is `authz.test.ts`'s;
// what these add is that *these* functions are behind it, reads included.

const modules = import.meta.glob("./**/*.ts");

const adminIdentity = {
  subject: "user_admin",
  issuer: "https://clerk.test",
  email: "owner@all2beat.com",
  publicMetadata: { role: "admin" },
};

const customerIdentity = {
  subject: "user_customer",
  issuer: "https://clerk.test",
  publicMetadata: { role: "customer" },
};

function asAdmin(t: ReturnType<typeof convexTest>) {
  return t.withIdentity(adminIdentity);
}

async function insertProduct(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<Doc<"products">> = {},
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
      syncStatus: "synced" as const,
      stripeProductId: "prod_existing",
      stripePriceId: "price_existing",
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

// The full form, as the edit screen submits it: every field every time, so a
// test only has to name what it is actually changing.
function savePayload(
  productId: Id<"products">,
  overrides: Record<string, unknown> = {},
) {
  return {
    productId,
    slug: "cacao-crunch",
    name: "Cacao Crunch",
    description: "Dark cacao and toasted oats.",
    priceCents: 499,
    imageIds: [],
    stock: 10,
    active: true,
    sortOrder: 0,
    ...overrides,
  };
}

describe("authorization", () => {
  test("the product list is refused to an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await insertProduct(t);

    await expect(t.query(api.products.listForAdmin, {})).rejects.toThrow(
      /not signed in/i,
    );
  });

  test("a single product is refused to a signed-in non-admin", async () => {
    const t = convexTest(schema, modules);
    const productId = await insertProduct(t);

    await expect(
      t.withIdentity(customerIdentity).query(api.products.getForAdmin, {
        productId,
      }),
    ).rejects.toThrow(/not an admin/i);
  });

  test("saving is refused to a signed-in non-admin, and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const productId = await insertProduct(t);

    await expect(
      t
        .withIdentity(customerIdentity)
        .mutation(api.products.save, savePayload(productId, { name: "Hacked" })),
    ).rejects.toThrow(/not an admin/i);
    expect((await readProduct(t, productId))?.name).toBe("Cacao Crunch");
  });

  test("the active toggle is refused to a signed-in non-admin", async () => {
    const t = convexTest(schema, modules);
    const productId = await insertProduct(t);

    await expect(
      t
        .withIdentity(customerIdentity)
        .mutation(api.products.setActive, { productId, active: false }),
    ).rejects.toThrow(/not an admin/i);
    expect((await readProduct(t, productId))?.active).toBe(true);
  });

  // An unguarded upload URL is a public write endpoint for anyone's blob.
  test("an image upload URL is refused to a signed-in non-admin", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.withIdentity(customerIdentity).mutation(api.products.generateImageUploadUrl, {}),
    ).rejects.toThrow(/not an admin/i);
  });

  test("a sync retry is refused to a signed-in non-admin", async () => {
    const t = convexTest(schema, modules);
    const productId = await insertProduct(t, { syncStatus: "error" });

    await expect(
      t
        .withIdentity(customerIdentity)
        .mutation(api.products.retrySync, { productId }),
    ).rejects.toThrow(/not an admin/i);
    expect((await readProduct(t, productId))?.syncStatus).toBe("error");
  });
});

describe("listForAdmin", () => {
  // The storefront list hides inactive products; this one must not — it is
  // where a deactivated product is found again and turned back on.
  test("includes inactive products, ordered by sortOrder", async () => {
    const t = convexTest(schema, modules);
    await insertProduct(t, { slug: "b", sortOrder: 1 });
    await insertProduct(t, { slug: "a", sortOrder: 0 });
    await insertProduct(t, { slug: "off", sortOrder: 2, active: false });

    const rows = await asAdmin(t).query(api.products.listForAdmin, {});

    expect(rows.map((row) => row.slug)).toEqual(["a", "b", "off"]);
  });

  test("carries the stock, active state, and sync status the list renders", async () => {
    const t = convexTest(schema, modules);
    await insertProduct(t, {
      stock: 12,
      reserved: 2,
      active: false,
      syncStatus: "error",
      syncError: "No such price: price_gone",
    });

    const [row] = await asAdmin(t).query(api.products.listForAdmin, {});

    expect(row).toMatchObject({
      name: "Cacao Crunch",
      priceCents: 499,
      stock: 12,
      reserved: 2,
      available: 10,
      active: false,
      syncStatus: "error",
      syncError: "No such price: price_gone",
      lowStock: false,
    });
  });

  // Available stock, not raw stock: units already held by an in-flight checkout
  // are not on the shelf, and a reorder decision made on the raw number is made
  // on a number nobody can buy against.
  test("flags low stock off what is actually available", async () => {
    const t = convexTest(schema, modules);
    await insertProduct(t, {
      stock: LOW_STOCK_THRESHOLD + 2,
      reserved: 3,
    });

    const [row] = await asAdmin(t).query(api.products.listForAdmin, {});

    expect(row).toMatchObject({ available: LOW_STOCK_THRESHOLD - 1, lowStock: true });
  });
});

describe("getForAdmin", () => {
  test("returns every field the edit form owns", async () => {
    const t = convexTest(schema, modules);
    const productId = await insertProduct(t, {
      compareAtCents: 699,
      description: "Dark cacao and toasted oats.",
      sortOrder: 3,
    });

    const product = await asAdmin(t).query(api.products.getForAdmin, {
      productId,
    });

    expect(product).toMatchObject({
      _id: productId,
      slug: "cacao-crunch",
      name: "Cacao Crunch",
      description: "Dark cacao and toasted oats.",
      priceCents: 499,
      compareAtCents: 699,
      stock: 10,
      active: true,
      sortOrder: 3,
      syncStatus: "synced",
      images: [],
    });
  });

  // A mistyped /admin/products/<id> URL is a "no such product" screen, not a
  // thrown argument-validation error.
  test("returns null for an id that isn't one", async () => {
    const t = convexTest(schema, modules);
    await insertProduct(t);

    await expect(
      asAdmin(t).query(api.products.getForAdmin, { productId: "not-an-id" }),
    ).resolves.toBeNull();
  });
});

describe("save", () => {
  test("writes every field the form owns", async () => {
    const t = convexTest(schema, modules);
    const productId = await insertProduct(t);

    await asAdmin(t).mutation(
      api.products.save,
      savePayload(productId, {
        slug: "cacao-crunch-xl",
        name: "Cacao Crunch XL",
        description: "Bigger.",
        priceCents: 599,
        compareAtCents: 799,
        stock: 48,
        active: false,
        sortOrder: 7,
      }),
    );

    expect(await readProduct(t, productId)).toMatchObject({
      slug: "cacao-crunch-xl",
      name: "Cacao Crunch XL",
      description: "Bigger.",
      priceCents: 599,
      compareAtCents: 799,
      stock: 48,
      active: false,
      sortOrder: 7,
    });
  });

  // Stock is set, never adjusted (spec user story 35) — the number in the box
  // is the number on the shelf, whatever it was before.
  test("sets stock to an absolute value rather than a delta", async () => {
    const t = convexTest(schema, modules);
    const productId = await insertProduct(t, { stock: 10, reserved: 4 });

    await asAdmin(t).mutation(api.products.save, savePayload(productId, { stock: 3 }));

    // `reserved` is the checkout flow's counter, not the form's: an edit must
    // not hand back units an in-flight session is holding.
    expect(await readProduct(t, productId)).toMatchObject({
      stock: 3,
      reserved: 4,
    });
  });

  test("clears a compare-at price the form submitted empty", async () => {
    const t = convexTest(schema, modules);
    const productId = await insertProduct(t, { compareAtCents: 699 });

    await asAdmin(t).mutation(api.products.save, savePayload(productId));

    expect((await readProduct(t, productId))?.compareAtCents).toBeUndefined();
  });

  test("trims the text fields", async () => {
    const t = convexTest(schema, modules);
    const productId = await insertProduct(t);

    await asAdmin(t).mutation(
      api.products.save,
      savePayload(productId, { name: "  Cacao Crunch  ", slug: "  cacao-xl  " }),
    );

    expect(await readProduct(t, productId)).toMatchObject({
      name: "Cacao Crunch",
      slug: "cacao-xl",
    });
  });

  // The slug is a URL key and the storefront's only lookup (`by_slug`), so a
  // collision would make one of the two products unreachable.
  test("refuses a slug another product already holds", async () => {
    const t = convexTest(schema, modules);
    await insertProduct(t, { slug: "almond-fig" });
    const productId = await insertProduct(t, { slug: "cacao-crunch" });

    await expect(
      asAdmin(t).mutation(
        api.products.save,
        savePayload(productId, { slug: "almond-fig" }),
      ),
    ).rejects.toThrow(/slug/i);
    expect((await readProduct(t, productId))?.slug).toBe("cacao-crunch");
  });

  test("keeps its own slug on a save that doesn't change it", async () => {
    const t = convexTest(schema, modules);
    const productId = await insertProduct(t);

    await asAdmin(t).mutation(api.products.save, savePayload(productId));

    expect((await readProduct(t, productId))?.slug).toBe("cacao-crunch");
  });

  test.each([
    ["a slug with spaces", { slug: "cacao crunch" }],
    ["an empty name", { name: "   " }],
    ["a fractional price", { priceCents: 4.99 }],
    ["a free product", { priceCents: 0 }],
    ["negative stock", { stock: -1 }],
    ["fractional stock", { stock: 1.5 }],
    ["a compare-at price below the price", { compareAtCents: 499 }],
  ])("refuses %s", async (_label, overrides) => {
    const t = convexTest(schema, modules);
    const productId = await insertProduct(t);

    await expect(
      asAdmin(t).mutation(api.products.save, savePayload(productId, overrides)),
    ).rejects.toThrow();
  });
});

describe("save and the Stripe mirror", () => {
  async function scheduledSyncCount(t: ReturnType<typeof convexTest>) {
    const jobs = await t.run(
      async (ctx) => await ctx.db.system.query("_scheduled_functions").collect(),
    );
    return jobs.filter((job) => job.name.startsWith("stripeSync")).length;
  }

  test.each([
    ["the price", { priceCents: 599 }],
    ["the name", { name: "Cacao Crunch XL" }],
    ["the description", { description: "Bigger." }],
    ["the slug", { slug: "cacao-crunch-xl" }],
    ["the active flag", { active: false }],
  ])("re-syncs when %s changes", async (_label, overrides) => {
    const t = convexTest(schema, modules);
    const productId = await insertProduct(t);

    await asAdmin(t).mutation(api.products.save, savePayload(productId, overrides));

    expect((await readProduct(t, productId))?.syncStatus).toBe("pending");
    expect(await scheduledSyncCount(t)).toBe(1);
  });

  // Stock, images, compare-at price, and sort order are Convex's alone —
  // Stripe mirrors none of them, so re-syncing on them would churn `syncStatus`
  // and spend Stripe calls for nothing.
  test("leaves the mirror alone when only Convex-owned fields change", async () => {
    const t = convexTest(schema, modules);
    const productId = await insertProduct(t);

    await asAdmin(t).mutation(
      api.products.save,
      savePayload(productId, { stock: 48, sortOrder: 9, compareAtCents: 799 }),
    );

    expect((await readProduct(t, productId))?.syncStatus).toBe("synced");
    expect(await scheduledSyncCount(t)).toBe(0);
  });

  // The product is unsellable until the mirror catches up, and nothing about it
  // has to change for the retry to be worth making — the failure may have been
  // a bad key or a Stripe outage.
  test("retrySync puts a failed product back in the queue", async () => {
    const t = convexTest(schema, modules);
    const productId = await insertProduct(t, {
      syncStatus: "error",
      syncError: "No such price",
    });

    await asAdmin(t).mutation(api.products.retrySync, { productId });

    const product = await readProduct(t, productId);
    expect(product?.syncStatus).toBe("pending");
    // The stale message is cleared, not left to be read as a live failure.
    expect(product?.syncError).toBeUndefined();
    expect(await scheduledSyncCount(t)).toBe(1);
  });

  test("setActive re-syncs, because Stripe mirrors the active flag", async () => {
    const t = convexTest(schema, modules);
    const productId = await insertProduct(t);

    await asAdmin(t).mutation(api.products.setActive, {
      productId,
      active: false,
    });

    expect(await readProduct(t, productId)).toMatchObject({
      active: false,
      syncStatus: "pending",
    });
    expect(await scheduledSyncCount(t)).toBe(1);
  });
});

// Story 37: seasonal and discontinued items are switched off, never destroyed.
test("a deactivated product leaves the storefront but not the table", async () => {
  const t = convexTest(schema, modules);
  const productId = await insertProduct(t);

  await asAdmin(t).mutation(api.products.setActive, { productId, active: false });

  expect(await t.query(api.products.listActive, {})).toEqual([]);
  expect(await t.query(api.products.getBySlug, { slug: "cacao-crunch" })).toBeNull();
  expect(await readProduct(t, productId)).not.toBeNull();
});
