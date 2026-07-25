/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

test("listActive returns only active products, ordered by sortOrder", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("products", {
      slug: "b",
      name: "B",
      description: "b",
      priceCents: 100,
      imageIds: [],
      stock: 10,
      reserved: 0,
      active: true,
      sortOrder: 1,
      syncStatus: "pending",
    });
    await ctx.db.insert("products", {
      slug: "a",
      name: "A",
      description: "a",
      priceCents: 100,
      imageIds: [],
      stock: 10,
      reserved: 0,
      active: true,
      sortOrder: 0,
      syncStatus: "pending",
    });
    await ctx.db.insert("products", {
      slug: "inactive",
      name: "Inactive",
      description: "x",
      priceCents: 100,
      imageIds: [],
      stock: 10,
      reserved: 0,
      active: false,
      sortOrder: -1,
      syncStatus: "pending",
    });
  });

  const products = await t.query(api.products.listActive, {});

  expect(products.map((p) => p.slug)).toEqual(["a", "b"]);
});

test("listActive computes available stock without exposing raw stock or reserved", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("products", {
      slug: "sold-out",
      name: "Sold Out",
      description: "x",
      priceCents: 100,
      imageIds: [],
      stock: 5,
      reserved: 5,
      active: true,
      sortOrder: 0,
      syncStatus: "pending",
    });
    await ctx.db.insert("products", {
      slug: "low-stock",
      name: "Low Stock",
      description: "x",
      priceCents: 100,
      imageIds: [],
      stock: 10,
      reserved: 8,
      active: true,
      sortOrder: 1,
      syncStatus: "pending",
    });
    await ctx.db.insert("products", {
      slug: "in-stock",
      name: "In Stock",
      description: "x",
      priceCents: 100,
      imageIds: [],
      stock: 20,
      reserved: 5,
      active: true,
      sortOrder: 2,
      syncStatus: "pending",
    });
  });

  const products = await t.query(api.products.listActive, {});
  const bySlug = Object.fromEntries(products.map((p) => [p.slug, p]));

  expect(bySlug["sold-out"]).toMatchObject({
    available: 0,
    availability: "sold-out",
  });
  expect(bySlug["low-stock"]).toMatchObject({
    available: 2,
    availability: "low-stock",
  });
  expect(bySlug["in-stock"]).toMatchObject({
    available: 15,
    availability: "in-stock",
  });

  for (const product of products) {
    expect(product).not.toHaveProperty("stock");
    expect(product).not.toHaveProperty("reserved");
  }
});

test("getBySlug returns null for inactive or unknown slugs", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("products", {
      slug: "hidden",
      name: "Hidden",
      description: "x",
      priceCents: 100,
      imageIds: [],
      stock: 10,
      reserved: 0,
      active: false,
      sortOrder: 0,
      syncStatus: "pending",
    });
  });

  expect(await t.query(api.products.getBySlug, { slug: "hidden" })).toBeNull();
  expect(
    await t.query(api.products.getBySlug, { slug: "missing" }),
  ).toBeNull();
});

test("getBySlug returns the active product with computed availability", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("products", {
      slug: "visible",
      name: "Visible",
      description: "x",
      priceCents: 250,
      imageIds: [],
      stock: 10,
      reserved: 2,
      active: true,
      sortOrder: 0,
      syncStatus: "pending",
    });
  });

  const product = await t.query(api.products.getBySlug, { slug: "visible" });

  expect(product).toMatchObject({
    slug: "visible",
    available: 8,
    availability: "in-stock",
  });
  expect(product).not.toHaveProperty("stock");
  expect(product).not.toHaveProperty("reserved");
});
