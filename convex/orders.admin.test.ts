/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

// Seam 1 (spec "Testing Decisions"): the /admin Orders read and write paths —
// ordering, the status filter, and what mark-shipped and notes do to the row.
// The authorization guarantee itself is `authz.test.ts`'s; what these add is
// that *these* functions are behind it, reads included.

const modules = import.meta.glob("./**/*.ts");

const adminIdentity = {
  subject: "user_admin",
  issuer: "https://clerk.test",
  email: "owner@all2beat.com",
  publicMetadata: { role: "admin" },
};

const SHIPPING_ADDRESS = {
  name: "Ada Lovelace",
  line1: "1 Analytical Way",
  city: "Tucson",
  state: "AZ",
  postalCode: "85701",
  country: "US",
};

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
});

// Orders are written straight to the table rather than driven through the
// webhook: what /admin does with an order is independent of how it got there.
async function seedOrders(
  t: ReturnType<typeof convexTest>,
  orders: Array<Partial<Doc<"orders">>>,
) {
  return await t.run(async (ctx) => {
    const productId = await ctx.db.insert("products", {
      slug: "cacao-crunch",
      name: "Cacao Crunch",
      description: "A snack bar.",
      priceCents: 499,
      imageIds: [],
      stock: 10,
      reserved: 0,
      active: true,
      sortOrder: 0,
      syncStatus: "synced" as const,
    });
    const ids: Id<"orders">[] = [];
    for (const [index, order] of orders.entries()) {
      ids.push(
        await ctx.db.insert("orders", {
          stripeSessionId: `cs_test_${index}`,
          stripePaymentIntentId: `pi_test_${index}`,
          email: `shopper${index}@example.com`,
          items: [
            {
              productId,
              name: "Cacao Crunch",
              unitPriceCents: 499,
              qty: 2,
            },
          ],
          subtotalCents: 998,
          shippingCents: 500,
          taxCents: 0,
          totalCents: 1498,
          shippingAddress: SHIPPING_ADDRESS,
          status: "paid" as const,
          paidAt: 1_000 + index,
          ...order,
        }),
      );
    }
    return ids;
  });
}

function asAdmin(t: ReturnType<typeof convexTest>) {
  return t.withIdentity(adminIdentity);
}

async function readOrder(t: ReturnType<typeof convexTest>, id: Id<"orders">) {
  return await t.run(async (ctx) => await ctx.db.get(id));
}

describe("authorization", () => {
  test("the list is refused to an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await seedOrders(t, [{}]);

    await expect(t.query(api.orders.list, {})).rejects.toThrow(/not signed in/i);
  });

  test("a single order is refused to a signed-in non-admin", async () => {
    const t = convexTest(schema, modules);
    const [orderId] = await seedOrders(t, [{}]);
    const asCustomer = t.withIdentity({
      subject: "user_customer",
      issuer: "https://clerk.test",
    });

    await expect(
      asCustomer.query(api.orders.get, { orderId }),
    ).rejects.toThrow(/not an admin/i);
  });

  test("mark-shipped is refused to a signed-in non-admin", async () => {
    const t = convexTest(schema, modules);
    const [orderId] = await seedOrders(t, [{}]);
    const asCustomer = t.withIdentity({
      subject: "user_customer",
      issuer: "https://clerk.test",
      publicMetadata: { role: "customer" },
    });

    await expect(
      asCustomer.mutation(api.orders.markShipped, { orderId }),
    ).rejects.toThrow(/not an admin/i);
    expect((await readOrder(t, orderId))?.status).toBe("paid");
  });

  test("saving a note is refused to a signed-in non-admin", async () => {
    const t = convexTest(schema, modules);
    const [orderId] = await seedOrders(t, [{}]);
    const asCustomer = t.withIdentity({
      subject: "user_customer",
      issuer: "https://clerk.test",
    });

    await expect(
      asCustomer.mutation(api.orders.saveNote, { orderId, note: "hi" }),
    ).rejects.toThrow(/not an admin/i);
    expect((await readOrder(t, orderId))?.notes).toBeUndefined();
  });
});

describe("list", () => {
  test("returns orders newest first", async () => {
    const t = convexTest(schema, modules);
    await seedOrders(t, [{}, {}, {}]);

    const rows = await asAdmin(t).query(api.orders.list, {});

    expect(rows.map((row) => row.email)).toEqual([
      "shopper2@example.com",
      "shopper1@example.com",
      "shopper0@example.com",
    ]);
  });

  test("narrows to one status, still newest first", async () => {
    const t = convexTest(schema, modules);
    await seedOrders(t, [
      { status: "shipped" },
      { status: "paid" },
      { status: "shipped" },
      { status: "refunded" },
    ]);

    const shipped = await asAdmin(t).query(api.orders.list, {
      status: "shipped",
    });

    expect(shipped.map((row) => row.email)).toEqual([
      "shopper2@example.com",
      "shopper0@example.com",
    ]);
  });

  test("carries the row summary the list screen renders", async () => {
    const t = convexTest(schema, modules);
    await seedOrders(t, [{ status: "shipped", trackingNumber: "1Z999" }]);

    const [row] = await asAdmin(t).query(api.orders.list, {});

    expect(row).toMatchObject({
      email: "shopper0@example.com",
      totalCents: 1498,
      status: "shipped",
      trackingNumber: "1Z999",
      items: [{ name: "Cacao Crunch", qty: 2 }],
    });
  });
});

describe("get", () => {
  test("returns the full snapshot and a Stripe payment link", async () => {
    const t = convexTest(schema, modules);
    const [orderId] = await seedOrders(t, [{}]);

    const order = await asAdmin(t).query(api.orders.get, { orderId });

    expect(order).toMatchObject({
      email: "shopper0@example.com",
      shippingAddress: SHIPPING_ADDRESS,
      items: [{ name: "Cacao Crunch", unitPriceCents: 499, qty: 2 }],
      stripePaymentUrl: "https://dashboard.stripe.com/test/payments/pi_test_0",
    });
  });

  test("links into live-mode Stripe when the deployment holds a live key", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_fake";
    const t = convexTest(schema, modules);
    const [orderId] = await seedOrders(t, [{}]);

    const order = await asAdmin(t).query(api.orders.get, { orderId });

    expect(order?.stripePaymentUrl).toBe(
      "https://dashboard.stripe.com/payments/pi_test_0",
    );
  });

  test("has no payment link for an order that never recorded an intent", async () => {
    const t = convexTest(schema, modules);
    const [orderId] = await seedOrders(t, [
      { stripePaymentIntentId: undefined },
    ]);

    const order = await asAdmin(t).query(api.orders.get, { orderId });

    expect(order?.stripePaymentUrl).toBeNull();
  });

  // A mistyped /admin/orders/<id> URL is a 404 screen, not a thrown
  // argument-validation error.
  test("returns null for an id that isn't one", async () => {
    const t = convexTest(schema, modules);
    await seedOrders(t, [{}]);

    await expect(
      asAdmin(t).query(api.orders.get, { orderId: "not-an-id" }),
    ).resolves.toBeNull();
  });
});

describe("markShipped", () => {
  test("records the status, the timestamp, and the tracking number", async () => {
    const t = convexTest(schema, modules);
    const [orderId] = await seedOrders(t, [{}]);

    await asAdmin(t).mutation(api.orders.markShipped, {
      orderId,
      trackingNumber: "1Z999AA10123456784",
    });

    const order = await readOrder(t, orderId);
    expect(order).toMatchObject({
      status: "shipped",
      trackingNumber: "1Z999AA10123456784",
    });
    expect(order?.shippedAt).toBeGreaterThan(0);
  });

  test("ships without a tracking number", async () => {
    const t = convexTest(schema, modules);
    const [orderId] = await seedOrders(t, [{}]);

    await asAdmin(t).mutation(api.orders.markShipped, { orderId });

    const order = await readOrder(t, orderId);
    expect(order?.status).toBe("shipped");
    expect(order?.trackingNumber).toBeUndefined();
  });

  test("treats a blank tracking number as none at all", async () => {
    const t = convexTest(schema, modules);
    const [orderId] = await seedOrders(t, [{}]);

    await asAdmin(t).mutation(api.orders.markShipped, {
      orderId,
      trackingNumber: "   ",
    });

    expect((await readOrder(t, orderId))?.trackingNumber).toBeUndefined();
  });

  // Fixing a mistyped tracking number is a correction, not a second shipment.
  test("keeps the original shippedAt when re-marked", async () => {
    const t = convexTest(schema, modules);
    const [orderId] = await seedOrders(t, [
      { status: "shipped", shippedAt: 12_345, trackingNumber: "TYPO" },
    ]);

    await asAdmin(t).mutation(api.orders.markShipped, {
      orderId,
      trackingNumber: "1Z999",
    });

    expect(await readOrder(t, orderId)).toMatchObject({
      shippedAt: 12_345,
      trackingNumber: "1Z999",
    });
  });

  // Story 31: the Dashboard owns the refund, and shipping over it would erase
  // the only record of one this store keeps.
  test("refuses to ship a refunded order", async () => {
    const t = convexTest(schema, modules);
    const [orderId] = await seedOrders(t, [{ status: "refunded" }]);

    await expect(
      asAdmin(t).mutation(api.orders.markShipped, { orderId }),
    ).rejects.toThrow(/refunded/i);
    expect((await readOrder(t, orderId))?.status).toBe("refunded");
  });

  test("refuses to ship a cancelled order", async () => {
    const t = convexTest(schema, modules);
    const [orderId] = await seedOrders(t, [{ status: "cancelled" }]);

    await expect(
      asAdmin(t).mutation(api.orders.markShipped, { orderId }),
    ).rejects.toThrow(/cancelled/i);
  });

  test("leaves a stored tracking number alone when none is passed", async () => {
    const t = convexTest(schema, modules);
    const [orderId] = await seedOrders(t, [
      { status: "shipped", trackingNumber: "1Z999" },
    ]);

    await asAdmin(t).mutation(api.orders.markShipped, { orderId });

    expect((await readOrder(t, orderId))?.trackingNumber).toBe("1Z999");
  });

  test("rejects an order that no longer exists", async () => {
    const t = convexTest(schema, modules);
    const [orderId] = await seedOrders(t, [{}]);
    await t.run(async (ctx) => await ctx.db.delete(orderId));

    await expect(
      asAdmin(t).mutation(api.orders.markShipped, { orderId }),
    ).rejects.toThrow(/no such order/i);
  });
});

describe("saveNote", () => {
  test("records an internal note", async () => {
    const t = convexTest(schema, modules);
    const [orderId] = await seedOrders(t, [{}]);

    await asAdmin(t).mutation(api.orders.saveNote, {
      orderId,
      note: "  Customer asked for it to be left at the side door.  ",
    });

    expect((await readOrder(t, orderId))?.notes).toBe(
      "Customer asked for it to be left at the side door.",
    );
  });

  test("clears the note when saved empty", async () => {
    const t = convexTest(schema, modules);
    const [orderId] = await seedOrders(t, [{ notes: "old" }]);

    await asAdmin(t).mutation(api.orders.saveNote, { orderId, note: "" });

    expect((await readOrder(t, orderId))?.notes).toBeUndefined();
  });
});
