/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { DEFAULT_SETTINGS } from "./settings";

// Seam 1 (spec "Testing Decisions"): the /admin Settings write path — what a
// save writes, what it refuses, and that the next checkout prices against it.
// The authorization guarantee itself is `authz.test.ts`'s; what these add is
// that *this* mutation is behind it.

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

// The whole form, as the screen submits it: all four values every time, so a
// test only has to name what it is actually changing.
function savePayload(overrides: Record<string, unknown> = {}) {
  return {
    taxEnabled: false,
    shippingFlatRateCents: 500,
    freeShippingThresholdCents: 2500,
    contactEmail: "hello@all2beat.com",
    ...overrides,
  };
}

async function seeded() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.settings.seedDefaults, {});
  return t;
}

async function readSettings(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => await ctx.db.query("settings").first());
}

describe("authorization", () => {
  test("saving is refused to an unauthenticated caller, and writes nothing", async () => {
    const t = await seeded();

    await expect(
      t.mutation(api.settings.save, savePayload({ shippingFlatRateCents: 0 })),
    ).rejects.toThrow(/not signed in/i);
    expect(await readSettings(t)).toMatchObject(DEFAULT_SETTINGS);
  });

  test("saving is refused to a signed-in non-admin, and writes nothing", async () => {
    const t = await seeded();

    await expect(
      t
        .withIdentity(customerIdentity)
        .mutation(api.settings.save, savePayload({ taxEnabled: true })),
    ).rejects.toThrow(/not an admin/i);
    expect(await readSettings(t)).toMatchObject({ taxEnabled: false });
  });
});

describe("save", () => {
  test("writes all four values to the singleton row", async () => {
    const t = await seeded();

    await asAdmin(t).mutation(
      api.settings.save,
      savePayload({
        taxEnabled: true,
        shippingFlatRateCents: 795,
        freeShippingThresholdCents: 5000,
        contactEmail: "orders@all2beat.com",
      }),
    );

    expect(await readSettings(t)).toMatchObject({
      taxEnabled: true,
      shippingFlatRateCents: 795,
      freeShippingThresholdCents: 5000,
      contactEmail: "orders@all2beat.com",
    });
  });

  test("keeps the row a singleton rather than inserting a second one", async () => {
    const t = await seeded();

    await asAdmin(t).mutation(api.settings.save, savePayload());
    await asAdmin(t).mutation(api.settings.save, savePayload());

    const all = await t.run(
      async (ctx) => await ctx.db.query("settings").collect(),
    );
    expect(all).toHaveLength(1);
  });

  // A deployment whose seed was never run would otherwise have no way out from
  // the screen: checkout refuses to run without a row, and the form is the one
  // place the owner can supply all four values.
  test("creates the row on a deployment that was never seeded", async () => {
    const t = convexTest(schema, modules);

    await asAdmin(t).mutation(
      api.settings.save,
      savePayload({ shippingFlatRateCents: 650 }),
    );

    expect(await readSettings(t)).toMatchObject({
      shippingFlatRateCents: 650,
    });
  });

  test("trims the contact email", async () => {
    const t = await seeded();

    await asAdmin(t).mutation(
      api.settings.save,
      savePayload({ contactEmail: "  orders@all2beat.com  " }),
    );

    expect((await readSettings(t))?.contactEmail).toBe("orders@all2beat.com");
  });

  // Story 39: the toggle is the whole mechanism — off by default, on the moment
  // the client confirms nexus registration, with no code change.
  test("the tax flag starts off and the toggle is what turns it on", async () => {
    const t = await seeded();
    expect((await readSettings(t))?.taxEnabled).toBe(false);

    await asAdmin(t).mutation(api.settings.save, savePayload({ taxEnabled: true }));
    expect((await readSettings(t))?.taxEnabled).toBe(true);

    await asAdmin(t).mutation(api.settings.save, savePayload({ taxEnabled: false }));
    expect((await readSettings(t))?.taxEnabled).toBe(false);
  });

  // Four values, and no more (ticket 11). A fifth field arriving here would be
  // a Setting nothing reads — the screen exists precisely because these four
  // are what checkout and the contact page consume.
  test("stores those four values and nothing else", async () => {
    const t = await seeded();

    await asAdmin(t).mutation(api.settings.save, savePayload());

    const row = await readSettings(t);
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "_creationTime",
      "_id",
      "contactEmail",
      "freeShippingThresholdCents",
      "shippingFlatRateCents",
      "taxEnabled",
    ]);
  });

  test.each([
    ["a negative shipping rate", { shippingFlatRateCents: -1 }],
    ["a fractional shipping rate", { shippingFlatRateCents: 4.99 }],
    ["a negative free-shipping threshold", { freeShippingThresholdCents: -1 }],
    ["a fractional free-shipping threshold", { freeShippingThresholdCents: 25.5 }],
    ["an empty contact email", { contactEmail: "   " }],
    ["a contact email that isn't an address", { contactEmail: "hello at all2beat" }],
  ])("refuses %s", async (_label, overrides) => {
    const t = await seeded();

    await expect(
      asAdmin(t).mutation(api.settings.save, savePayload(overrides)),
    ).rejects.toThrow();
    expect(await readSettings(t)).toMatchObject(DEFAULT_SETTINGS);
  });

  // Zero is a real answer to both, not a missing one: free shipping on every
  // order, and a threshold of zero that checkout already reads as "always free".
  test.each([
    ["free shipping for everyone", { shippingFlatRateCents: 0 }],
    ["a zero free-shipping threshold", { freeShippingThresholdCents: 0 }],
  ])("accepts %s", async (_label, overrides) => {
    const t = await seeded();

    await asAdmin(t).mutation(api.settings.save, savePayload(overrides));

    expect(await readSettings(t)).toMatchObject(overrides);
  });

  // Convex redacts a plain thrown message to "Server Error" in production. The
  // rejection messages here are written for the store owner and shown verbatim
  // by the form, so they have to travel as `ConvexError` data.
  test("rejects with a message the form can show the owner", async () => {
    const t = await seeded();

    const failure = await asAdmin(t)
      .mutation(api.settings.save, savePayload({ shippingFlatRateCents: -1 }))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ConvexError);
    expect((failure as ConvexError<string>).data).toMatch(/[Ss]hipping rate/);
  });
});

// The point of the whole ticket (ADR-0004): the numbers the owner types are the
// numbers the *next* checkout prices against — no Stripe Dashboard trip, no
// redeploy. `reserveCart` reads the row live, so a save is enough.
test("a saved change reaches the next checkout without a redeploy", async () => {
  const t = await seeded();
  await t.run(async (ctx) => {
    await ctx.db.insert("products", {
      slug: "cacao-crunch",
      name: "Cacao Crunch",
      description: "Dark cacao and toasted oats.",
      priceCents: 499,
      imageIds: [],
      stock: 10,
      reserved: 0,
      active: true,
      sortOrder: 0,
      syncStatus: "synced",
      stripeProductId: "prod_existing",
      stripePriceId: "price_existing",
    });
  });

  await asAdmin(t).mutation(
    api.settings.save,
    savePayload({
      taxEnabled: true,
      shippingFlatRateCents: 795,
      freeShippingThresholdCents: 9900,
    }),
  );

  const result = await t.mutation(api.checkout.reserveCart, {
    items: [{ slug: "cacao-crunch", qty: 1 }],
  });

  expect(result.ok).toBe(true);
  expect(result.ok === true && result.quote.settings).toEqual({
    taxEnabled: true,
    shippingFlatRateCents: 795,
    freeShippingThresholdCents: 9900,
  });
});
