/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

test("seedDefaults inserts a settings row readable via the settings query", async () => {
  const t = convexTest(schema, modules);

  await t.mutation(internal.settings.seedDefaults, {});
  const settings = await t.query(api.settings.get, {});

  expect(settings).toMatchObject({
    taxEnabled: false,
    shippingFlatRateCents: 500,
    freeShippingThresholdCents: 2500,
  });
});

test("seedDefaults does not duplicate the settings row when run twice", async () => {
  const t = convexTest(schema, modules);

  const firstId = await t.mutation(internal.settings.seedDefaults, {});
  const secondId = await t.mutation(internal.settings.seedDefaults, {});

  expect(secondId).toBe(firstId);
  const all = await t.run(async (ctx) => await ctx.db.query("settings").collect());
  expect(all).toHaveLength(1);
});
