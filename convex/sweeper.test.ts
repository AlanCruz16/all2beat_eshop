/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { SWEEP_BATCH_SIZE } from "./checkout";

// Seam 1 (spec "Testing Decisions"): the sweeper's selection rule and the stock
// math that follows it, asserted on the rows afterwards. That the cron is
// registered at five minutes is a wiring fact, checked at the bottom.

const modules = import.meta.glob("./**/*.ts");

const HOUR_MS = 60 * 60_000;

async function setup() {
  const t = convexTest(schema, modules);
  const productId = await t.run(
    async (ctx) =>
      await ctx.db.insert("products", {
        slug: "bar-0",
        name: "Bar 0",
        description: "A snack bar.",
        priceCents: 499,
        imageIds: [],
        stock: 100,
        reserved: 0,
        active: true,
        sortOrder: 0,
        syncStatus: "synced",
        stripeProductId: "prod_0",
        stripePriceId: "price_0",
      }),
  );
  return { t, productId };
}

async function insertReservation(
  t: ReturnType<typeof convexTest>,
  productId: Id<"products">,
  fields: { status: Doc<"reservations">["status"]; expiresAt: number; qty: number },
) {
  return await t.run(async (ctx) => {
    const product = await ctx.db.get(productId);
    if (product === null) {
      throw new Error("missing product");
    }
    // The counter has to match what the row holds, exactly as `reserveCart`
    // leaves it — a sweep that decrements is only correct against that.
    await ctx.db.patch(productId, { reserved: product.reserved + fields.qty });
    return await ctx.db.insert("reservations", {
      items: [
        {
          productId,
          qty: fields.qty,
          name: "Bar 0",
          unitPriceCents: 499,
        },
      ],
      expiresAt: fields.expiresAt,
      status: fields.status,
    });
  });
}

async function readReserved(
  t: ReturnType<typeof convexTest>,
  productId: Id<"products">,
) {
  return (await t.run(async (ctx) => await ctx.db.get(productId)))?.reserved;
}

async function statusOf(
  t: ReturnType<typeof convexTest>,
  reservationId: Id<"reservations">,
) {
  return (await t.run(async (ctx) => await ctx.db.get(reservationId)))?.status;
}

test("an expired hold is released and its units go back to available stock", async () => {
  const { t, productId } = await setup();
  const reservationId = await insertReservation(t, productId, {
    status: "held",
    expiresAt: Date.now() - HOUR_MS,
    qty: 4,
  });

  await t.mutation(internal.checkout.sweepExpiredReservations, {});

  expect(await statusOf(t, reservationId)).toBe("released");
  expect(await readReserved(t, productId)).toBe(0);
});

test("a hold that has not expired yet is left alone", async () => {
  const { t, productId } = await setup();
  const reservationId = await insertReservation(t, productId, {
    status: "held",
    expiresAt: Date.now() + HOUR_MS,
    qty: 4,
  });

  await t.mutation(internal.checkout.sweepExpiredReservations, {});

  expect(await statusOf(t, reservationId)).toBe("held");
  expect(await readReserved(t, productId)).toBe(4);
});

test("a committed reservation is never swept, however long past its expiry", async () => {
  const { t, productId } = await setup();
  // A paid session: the webhook already moved stock and cleared the hold, so a
  // sweep here would decrement a counter that no longer owes anything.
  const reservationId = await insertReservation(t, productId, {
    status: "committed",
    expiresAt: Date.now() - HOUR_MS,
    qty: 4,
  });

  await t.mutation(internal.checkout.sweepExpiredReservations, {});

  expect(await statusOf(t, reservationId)).toBe("committed");
  expect(await readReserved(t, productId)).toBe(4);
});

test("an already-released reservation is not released a second time", async () => {
  const { t, productId } = await setup();
  const reservationId = await insertReservation(t, productId, {
    status: "released",
    expiresAt: Date.now() - HOUR_MS,
    qty: 4,
  });

  await t.mutation(internal.checkout.sweepExpiredReservations, {});

  expect(await statusOf(t, reservationId)).toBe("released");
  // Untouched: whoever released it first already gave these units back, and
  // this test's fixture stands in for the counter they left behind.
  expect(await readReserved(t, productId)).toBe(4);
});

test("sweeping picks out only the expired holds from a mixed table", async () => {
  const { t, productId } = await setup();
  const expiredHeld = await insertReservation(t, productId, {
    status: "held",
    expiresAt: Date.now() - HOUR_MS,
    qty: 1,
  });
  const liveHeld = await insertReservation(t, productId, {
    status: "held",
    expiresAt: Date.now() + HOUR_MS,
    qty: 2,
  });
  const committed = await insertReservation(t, productId, {
    status: "committed",
    expiresAt: Date.now() - HOUR_MS,
    qty: 4,
  });
  const released = await insertReservation(t, productId, {
    status: "released",
    expiresAt: Date.now() - HOUR_MS,
    qty: 8,
  });

  await t.mutation(internal.checkout.sweepExpiredReservations, {});

  expect(await statusOf(t, expiredHeld)).toBe("released");
  expect(await statusOf(t, liveHeld)).toBe("held");
  expect(await statusOf(t, committed)).toBe("committed");
  expect(await statusOf(t, released)).toBe("released");
  // 15 reserved going in, minus only the 1 the expired hold owned.
  expect(await readReserved(t, productId)).toBe(14);
});

test("sweeping twice does not hand the same units back twice", async () => {
  const { t, productId } = await setup();
  await insertReservation(t, productId, {
    status: "held",
    expiresAt: Date.now() - HOUR_MS,
    qty: 3,
  });

  await t.mutation(internal.checkout.sweepExpiredReservations, {});
  await t.mutation(internal.checkout.sweepExpiredReservations, {});

  expect(await readReserved(t, productId)).toBe(0);
});

test("a backlog larger than one batch is cleared by successive sweeps", async () => {
  const { t, productId } = await setup();
  const backlog = SWEEP_BATCH_SIZE + 3;
  for (let index = 0; index < backlog; index += 1) {
    await insertReservation(t, productId, {
      status: "held",
      expiresAt: Date.now() - HOUR_MS,
      qty: 1,
    });
  }

  const first = await t.mutation(internal.checkout.sweepExpiredReservations, {});
  expect(first).toEqual({ released: SWEEP_BATCH_SIZE });
  expect(await readReserved(t, productId)).toBe(3);

  const second = await t.mutation(internal.checkout.sweepExpiredReservations, {});
  expect(second).toEqual({ released: 3 });
  expect(await readReserved(t, productId)).toBe(0);
});

test("the sweep runs every five minutes", async () => {
  const crons = (await import("./crons")).default;
  const jobs = Object.values(crons.crons);

  expect(jobs).toEqual([
    expect.objectContaining({
      name: "checkout:sweepExpiredReservations",
      schedule: { type: "interval", minutes: 5 },
    }),
  ]);
});
