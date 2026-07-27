/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { DEFAULT_SETTINGS } from "./settings";
import { RESERVATION_TTL_MS } from "./checkout";

// Seam 1 (spec "Testing Decisions"): reservation and stock math at the Convex
// function boundary, asserting observable outcomes — the products and
// reservations rows after the call, and the structured result the UI renders.
// Whether the Stripe parameters we build from a quote are valid is Seam 2's
// job (`checkout.seam2.test.ts`); the shipping/tax arithmetic itself is a pure
// function, covered in `lib/checkout.test.ts`.

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useRealTimers();
});

type ProductOverrides = Partial<Doc<"products">>;

async function setup(overrides: ProductOverrides[] = [{}]) {
  const t = convexTest(schema, modules);
  const productIds = await t.run(async (ctx) => {
    await ctx.db.insert("settings", DEFAULT_SETTINGS);
    return await Promise.all(
      overrides.map((override, index) =>
        ctx.db.insert("products", {
          slug: `bar-${index}`,
          name: `Bar ${index}`,
          description: "A snack bar.",
          priceCents: 499,
          imageIds: [],
          stock: 10,
          reserved: 0,
          active: true,
          sortOrder: index,
          syncStatus: "synced",
          stripeProductId: `prod_${index}`,
          stripePriceId: `price_${index}`,
          ...override,
        }),
      ),
    );
  });
  return { t, productIds };
}

async function readProduct(
  t: ReturnType<typeof convexTest>,
  productId: Id<"products">,
) {
  return await t.run(async (ctx) => await ctx.db.get(productId));
}

test("reserving exactly the available stock succeeds and holds every unit", async () => {
  const { t, productIds } = await setup([{ stock: 3, reserved: 0 }]);

  const result = await t.mutation(api.checkout.reserveCart, {
    items: [{ slug: "bar-0", qty: 3 }],
  });

  expect(result.ok).toBe(true);
  expect((await readProduct(t, productIds[0]))?.reserved).toBe(3);
});

test("reserving one more than is available reserves nothing and reports how many are left", async () => {
  const { t, productIds } = await setup([{ stock: 3, reserved: 0 }]);

  const result = await t.mutation(api.checkout.reserveCart, {
    items: [{ slug: "bar-0", qty: 4 }],
  });

  expect(result).toEqual({
    ok: false,
    errors: [
      {
        slug: "bar-0",
        name: "Bar 0",
        reason: "insufficient-stock",
        availableQty: 3,
      },
    ],
  });
  expect((await readProduct(t, productIds[0]))?.reserved).toBe(0);
  const reservations = await t.run(
    async (ctx) => await ctx.db.query("reservations").collect(),
  );
  expect(reservations).toHaveLength(0);
});

test("availability is stock minus what other checkouts already hold", async () => {
  // Stock of 5 with 4 already held by an in-flight session leaves 1.
  const { t } = await setup([{ stock: 5, reserved: 4 }]);

  const result = await t.mutation(api.checkout.reserveCart, {
    items: [{ slug: "bar-0", qty: 2 }],
  });

  expect(result).toMatchObject({
    ok: false,
    errors: [{ reason: "insufficient-stock", availableQty: 1 }],
  });
});

test("a second checkout cannot take the units the first one reserved", async () => {
  const { t, productIds } = await setup([{ stock: 4, reserved: 0 }]);

  const first = await t.mutation(api.checkout.reserveCart, {
    items: [{ slug: "bar-0", qty: 3 }],
  });
  const second = await t.mutation(api.checkout.reserveCart, {
    items: [{ slug: "bar-0", qty: 3 }],
  });

  expect(first.ok).toBe(true);
  expect(second).toMatchObject({
    ok: false,
    errors: [{ reason: "insufficient-stock", availableQty: 1 }],
  });
  // The winner keeps its hold; the loser adds nothing.
  expect((await readProduct(t, productIds[0]))?.reserved).toBe(3);
});

test("a multi-line cart is all-or-nothing — one short line reserves none of it", async () => {
  const { t, productIds } = await setup([
    { stock: 10, reserved: 0 },
    { stock: 1, reserved: 0 },
  ]);

  const result = await t.mutation(api.checkout.reserveCart, {
    items: [
      { slug: "bar-0", qty: 2 },
      { slug: "bar-1", qty: 2 },
    ],
  });

  expect(result).toMatchObject({
    ok: false,
    errors: [{ slug: "bar-1", reason: "insufficient-stock" }],
  });
  expect((await readProduct(t, productIds[0]))?.reserved).toBe(0);
  expect((await readProduct(t, productIds[1]))?.reserved).toBe(0);
});

test("an inactive product is reported unavailable, an unknown slug likewise", async () => {
  const { t } = await setup([{ active: false }]);

  const result = await t.mutation(api.checkout.reserveCart, {
    items: [
      { slug: "bar-0", qty: 1 },
      { slug: "never-existed", qty: 1 },
    ],
  });

  expect(result).toEqual({
    ok: false,
    errors: [
      { slug: "bar-0", reason: "unavailable", availableQty: 0 },
      { slug: "never-existed", reason: "unavailable", availableQty: 0 },
    ],
  });
});

test("a product whose Stripe mirror failed cannot be sold", async () => {
  const { t } = await setup([
    { syncStatus: "error", syncError: "Stripe rejected the price" },
  ]);

  const result = await t.mutation(api.checkout.reserveCart, {
    items: [{ slug: "bar-0", qty: 1 }],
  });

  expect(result).toMatchObject({
    ok: false,
    errors: [{ slug: "bar-0", reason: "unsellable" }],
  });
});

test("the quote carries live prices, the mirrored Price ids, and the settings row", async () => {
  const { t } = await setup([
    { priceCents: 600, stripePriceId: "price_live" },
    { priceCents: 250, stripePriceId: "price_other" },
  ]);

  const result = await t.mutation(api.checkout.reserveCart, {
    items: [
      { slug: "bar-0", qty: 2 },
      { slug: "bar-1", qty: 1 },
    ],
  });

  expect(result).toMatchObject({
    ok: true,
    quote: {
      subtotalCents: 1450,
      lines: [
        { slug: "bar-0", qty: 2, unitPriceCents: 600, stripePriceId: "price_live" },
        { slug: "bar-1", qty: 1, unitPriceCents: 250, stripePriceId: "price_other" },
      ],
      settings: {
        taxEnabled: false,
        shippingFlatRateCents: 500,
        freeShippingThresholdCents: 2500,
      },
    },
  });
});

test("the reservation expires with the Stripe session it is created for", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-27T12:00:00Z"));
  const { t } = await setup();

  const result = await t.mutation(api.checkout.reserveCart, {
    items: [{ slug: "bar-0", qty: 1 }],
  });

  if (!result.ok) {
    throw new Error("expected the reservation to succeed");
  }
  expect(result.quote.expiresAt).toBe(Date.now() + RESERVATION_TTL_MS);
  const reservation = await t.run(
    async (ctx) => await ctx.db.get(result.quote.reservationId),
  );
  expect(reservation).toMatchObject({
    status: "held",
    expiresAt: result.quote.expiresAt,
  });
  // The 30 minutes masterplan §5.1 specifies. That Stripe accepts a timestamp
  // computed this tightly is Seam 2's assertion, not this one's.
  expect(RESERVATION_TTL_MS).toBe(30 * 60_000);
});

test("releasing a reservation gives the stock back and marks it released", async () => {
  const { t, productIds } = await setup([{ stock: 10, reserved: 0 }]);
  const reserved = await t.mutation(api.checkout.reserveCart, {
    items: [{ slug: "bar-0", qty: 4 }],
  });
  if (!reserved.ok) {
    throw new Error("expected the reservation to succeed");
  }

  await t.mutation(api.checkout.releaseReservation, {
    reservationId: reserved.quote.reservationId,
  });

  expect((await readProduct(t, productIds[0]))?.reserved).toBe(0);
  expect(
    await t.run(async (ctx) => await ctx.db.get(reserved.quote.reservationId)),
  ).toMatchObject({ status: "released" });
});

test("releasing twice does not hand back the stock twice", async () => {
  const { t, productIds } = await setup([{ stock: 10, reserved: 2 }]);
  const reserved = await t.mutation(api.checkout.reserveCart, {
    items: [{ slug: "bar-0", qty: 4 }],
  });
  if (!reserved.ok) {
    throw new Error("expected the reservation to succeed");
  }

  await t.mutation(api.checkout.releaseReservation, {
    reservationId: reserved.quote.reservationId,
  });
  await t.mutation(api.checkout.releaseReservation, {
    reservationId: reserved.quote.reservationId,
  });

  // Back to the 2 units another checkout was already holding, not below it.
  expect((await readProduct(t, productIds[0]))?.reserved).toBe(2);
});

test("a committed reservation is not released", async () => {
  const { t, productIds } = await setup([{ stock: 10, reserved: 0 }]);
  const reserved = await t.mutation(api.checkout.reserveCart, {
    items: [{ slug: "bar-0", qty: 4 }],
  });
  if (!reserved.ok) {
    throw new Error("expected the reservation to succeed");
  }
  await t.run(async (ctx) => {
    await ctx.db.patch(reserved.quote.reservationId, { status: "committed" });
  });

  await t.mutation(api.checkout.releaseReservation, {
    reservationId: reserved.quote.reservationId,
  });

  expect((await readProduct(t, productIds[0]))?.reserved).toBe(4);
  expect(
    await t.run(async (ctx) => await ctx.db.get(reserved.quote.reservationId)),
  ).toMatchObject({ status: "committed" });
});

test("attachSession records the session id on a held reservation only", async () => {
  const { t } = await setup();
  const reserved = await t.mutation(api.checkout.reserveCart, {
    items: [{ slug: "bar-0", qty: 1 }],
  });
  if (!reserved.ok) {
    throw new Error("expected the reservation to succeed");
  }
  const { reservationId } = reserved.quote;

  await t.mutation(api.checkout.attachSession, {
    reservationId,
    stripeSessionId: "cs_test_123",
  });
  expect(await t.run(async (ctx) => await ctx.db.get(reservationId))).toMatchObject(
    { stripeSessionId: "cs_test_123" },
  );

  // Once settled, the row no longer accepts a session id — re-pointing it would
  // misattribute whatever the webhook or the sweeper already did.
  await t.mutation(api.checkout.releaseReservation, { reservationId });
  await t.mutation(api.checkout.attachSession, {
    reservationId,
    stripeSessionId: "cs_test_other",
  });
  expect(await t.run(async (ctx) => await ctx.db.get(reservationId))).toMatchObject(
    { stripeSessionId: "cs_test_123" },
  );
});

test("a malformed or oversized request is rejected outright", async () => {
  const { t } = await setup();

  await expect(
    t.mutation(api.checkout.reserveCart, { items: [] }),
  ).rejects.toThrow(/empty cart/);
  await expect(
    t.mutation(api.checkout.reserveCart, {
      items: [{ slug: "bar-0", qty: 0 }],
    }),
  ).rejects.toThrow(/Invalid quantity/);
  await expect(
    t.mutation(api.checkout.reserveCart, {
      items: [{ slug: "bar-0", qty: 1.5 }],
    }),
  ).rejects.toThrow(/Invalid quantity/);
  await expect(
    t.mutation(api.checkout.reserveCart, {
      items: [
        { slug: "bar-0", qty: 1 },
        { slug: "bar-0", qty: 1 },
      ],
    }),
  ).rejects.toThrow(/Duplicate slugs/);
});

test("checkout refuses to run without a settings row", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("products", {
      slug: "bar-0",
      name: "Bar 0",
      description: "A snack bar.",
      priceCents: 499,
      imageIds: [],
      stock: 10,
      reserved: 0,
      active: true,
      sortOrder: 0,
      syncStatus: "synced",
      stripeProductId: "prod_0",
      stripePriceId: "price_0",
    });
  });

  await expect(
    t.mutation(api.checkout.reserveCart, {
      items: [{ slug: "bar-0", qty: 1 }],
    }),
  ).rejects.toThrow(/settings/);
});
