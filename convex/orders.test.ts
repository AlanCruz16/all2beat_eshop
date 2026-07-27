/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { DEFAULT_SETTINGS } from "./settings";

// Seam 1 (spec "Testing Decisions"): what a webhook delivery does to the
// tables — the order it writes, the reservation it settles, and the stock it
// moves — plus the idempotency guard that has to survive Stripe's retries.
// Signature verification against a real signed payload is Seam 2's job
// (`webhook.seam2.test.ts`); here the Stripe SDK is a mock, so these tests can
// drive the HTTP endpoint without a key or a network.

const stripe = vi.hoisted(() => ({
  webhooks: { constructEventAsync: vi.fn() },
}));

// `http.ts` verifies through the statics — no client, and so no secret key —
// so that is what the mock has to provide.
vi.mock("stripe", () => ({
  default: {
    webhooks: stripe.webhooks,
    createSubtleCryptoProvider: () => ({}),
  },
}));

const modules = import.meta.glob("./**/*.ts");

const SHIPPING_ADDRESS = {
  name: "Ada Lovelace",
  line1: "1 Analytical Way",
  city: "Tucson",
  state: "AZ",
  postalCode: "85701",
  country: "US",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";
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
          syncStatus: "synced" as const,
          stripeProductId: `prod_${index}`,
          stripePriceId: `price_${index}`,
          ...override,
        }),
      ),
    );
  });
  return { t, productIds };
}

// The state the webhook expects to find: a reservation holding stock, with the
// Stripe session id already attached by `createCheckoutSession`.
async function reserve(
  t: ReturnType<typeof convexTest>,
  items: Array<{ slug: string; qty: number }>,
  sessionId = "cs_test_123",
) {
  const reserved = await t.mutation(api.checkout.reserveCart, { items });
  if (!reserved.ok) {
    throw new Error("expected the reservation to succeed");
  }
  await t.mutation(api.checkout.attachSession, {
    reservationId: reserved.quote.reservationId,
    stripeSessionId: sessionId,
  });
  return reserved.quote.reservationId;
}

function completedArgs(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "evt_completed_1",
    sessionId: "cs_test_123",
    paymentIntentId: "pi_test_123",
    email: "ada@example.com",
    subtotalCents: 998,
    shippingCents: 500,
    taxCents: 0,
    totalCents: 1498,
    shippingAddress: SHIPPING_ADDRESS,
    ...overrides,
  };
}

async function readProduct(
  t: ReturnType<typeof convexTest>,
  productId: Id<"products">,
) {
  return await t.run(async (ctx) => await ctx.db.get(productId));
}

async function readOrders(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => await ctx.db.query("orders").collect());
}

async function readEvents(t: ReturnType<typeof convexTest>) {
  return await t.run(
    async (ctx) => await ctx.db.query("stripeEvents").collect(),
  );
}

test("a completed checkout writes the order, commits the hold, and moves the stock", async () => {
  const { t, productIds } = await setup([{ stock: 10, reserved: 0 }]);
  const reservationId = await reserve(t, [{ slug: "bar-0", qty: 2 }]);

  await t.mutation(internal.orders.recordCheckoutCompleted, completedArgs());

  const orders = await readOrders(t);
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({
    stripeSessionId: "cs_test_123",
    stripePaymentIntentId: "pi_test_123",
    email: "ada@example.com",
    status: "paid",
    subtotalCents: 998,
    shippingCents: 500,
    taxCents: 0,
    totalCents: 1498,
    shippingAddress: SHIPPING_ADDRESS,
    items: [
      { productId: productIds[0], name: "Bar 0", unitPriceCents: 499, qty: 2 },
    ],
  });
  // Stock leaves the shelf only now, and the hold on it goes with it.
  expect(await readProduct(t, productIds[0])).toMatchObject({
    stock: 8,
    reserved: 0,
  });
  expect(await t.run(async (ctx) => await ctx.db.get(reservationId))).toMatchObject(
    { status: "committed" },
  );
});

test("the order snapshots the price the shopper was quoted, not today's", async () => {
  const { t, productIds } = await setup([{ priceCents: 499 }]);
  await reserve(t, [{ slug: "bar-0", qty: 1 }]);
  // The Admin raises the price mid-checkout. Stripe still charges the Price the
  // session was created against, so the order has to record that one.
  await t.run(async (ctx) => {
    await ctx.db.patch(productIds[0], { priceCents: 899, name: "Bar 0 v2" });
  });

  await t.mutation(
    internal.orders.recordCheckoutCompleted,
    completedArgs({ subtotalCents: 499, totalCents: 999 }),
  );

  const orders = await readOrders(t);
  expect(orders[0].items).toEqual([
    { productId: productIds[0], name: "Bar 0", unitPriceCents: 499, qty: 1 },
  ]);
});

test("replaying the same event id is a no-op", async () => {
  const { t, productIds } = await setup([{ stock: 10 }]);
  await reserve(t, [{ slug: "bar-0", qty: 2 }]);

  await t.mutation(internal.orders.recordCheckoutCompleted, completedArgs());
  await t.mutation(internal.orders.recordCheckoutCompleted, completedArgs());

  expect(await readOrders(t)).toHaveLength(1);
  // The whole point of the guard: a retry must not decrement twice.
  expect(await readProduct(t, productIds[0])).toMatchObject({
    stock: 8,
    reserved: 0,
  });
  // And it stopped at the `stripeEvents` claim rather than at one of the
  // downstream guards — a second row here would mean the retry ran the handler.
  expect(await readEvents(t)).toMatchObject([
    { eventId: "evt_completed_1", type: "checkout.session.completed" },
  ]);
});

test("a fresh event for a session already ordered does not double-charge the stock", async () => {
  const { t, productIds } = await setup([{ stock: 10 }]);
  await reserve(t, [{ slug: "bar-0", qty: 2 }]);

  await t.mutation(internal.orders.recordCheckoutCompleted, completedArgs());
  // Same session, different event id — the idempotency table can't catch this
  // one, so the order-by-session check has to.
  await t.mutation(
    internal.orders.recordCheckoutCompleted,
    completedArgs({ eventId: "evt_completed_2" }),
  );

  expect(await readOrders(t)).toHaveLength(1);
  expect(await readProduct(t, productIds[0])).toMatchObject({
    stock: 8,
    reserved: 0,
  });
});

test("a multi-line order commits every line", async () => {
  const { t, productIds } = await setup([
    { stock: 10, priceCents: 499 },
    { stock: 4, priceCents: 250 },
  ]);
  await reserve(t, [
    { slug: "bar-0", qty: 2 },
    { slug: "bar-1", qty: 3 },
  ]);

  await t.mutation(
    internal.orders.recordCheckoutCompleted,
    completedArgs({ subtotalCents: 1748, totalCents: 2248 }),
  );

  expect((await readOrders(t))[0].items).toEqual([
    { productId: productIds[0], name: "Bar 0", unitPriceCents: 499, qty: 2 },
    { productId: productIds[1], name: "Bar 1", unitPriceCents: 250, qty: 3 },
  ]);
  expect(await readProduct(t, productIds[0])).toMatchObject({
    stock: 8,
    reserved: 0,
  });
  expect(await readProduct(t, productIds[1])).toMatchObject({
    stock: 1,
    reserved: 0,
  });
});

test("a payment whose reservation vanished is still recorded as an order", async () => {
  // Money has changed hands; refusing to write the order because our own hold
  // is missing would lose the sale entirely. The line snapshot is what's lost.
  const { t, productIds } = await setup();

  await t.mutation(internal.orders.recordCheckoutCompleted, completedArgs());

  const orders = await readOrders(t);
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({ status: "paid", items: [], totalCents: 1498 });
  expect(await readProduct(t, productIds[0])).toMatchObject({ stock: 10 });
});

test("an expired session gives the hold back and leaves stock untouched", async () => {
  const { t, productIds } = await setup([{ stock: 10 }]);
  const reservationId = await reserve(t, [{ slug: "bar-0", qty: 3 }]);

  await t.mutation(internal.orders.recordCheckoutExpired, {
    eventId: "evt_expired_1",
    sessionId: "cs_test_123",
  });

  expect(await readProduct(t, productIds[0])).toMatchObject({
    stock: 10,
    reserved: 0,
  });
  expect(await t.run(async (ctx) => await ctx.db.get(reservationId))).toMatchObject(
    { status: "released" },
  );
  expect(await readOrders(t)).toHaveLength(0);
});

test("replaying an expiry does not hand the stock back twice", async () => {
  const { t, productIds } = await setup([{ stock: 10, reserved: 2 }]);
  await reserve(t, [{ slug: "bar-0", qty: 3 }]);

  await t.mutation(internal.orders.recordCheckoutExpired, {
    eventId: "evt_expired_1",
    sessionId: "cs_test_123",
  });
  await t.mutation(internal.orders.recordCheckoutExpired, {
    eventId: "evt_expired_1",
    sessionId: "cs_test_123",
  });

  // Back to the 2 units another checkout holds, not below them.
  expect(await readProduct(t, productIds[0])).toMatchObject({ reserved: 2 });
  expect(await readEvents(t)).toHaveLength(1);
});

test("an expiry arriving after the payment leaves the committed order alone", async () => {
  // Stripe can deliver these out of order; the sale wins.
  const { t, productIds } = await setup([{ stock: 10 }]);
  const reservationId = await reserve(t, [{ slug: "bar-0", qty: 2 }]);
  await t.mutation(internal.orders.recordCheckoutCompleted, completedArgs());

  await t.mutation(internal.orders.recordCheckoutExpired, {
    eventId: "evt_expired_1",
    sessionId: "cs_test_123",
  });

  expect(await t.run(async (ctx) => await ctx.db.get(reservationId))).toMatchObject(
    { status: "committed" },
  );
  expect(await readProduct(t, productIds[0])).toMatchObject({
    stock: 8,
    reserved: 0,
  });
});

test("a payment that lands after the hold was swept still takes the stock", async () => {
  // The reservation and the Stripe session expire at the same instant, so a
  // payment taken just before it can arrive just after the sweeper (ticket 07)
  // handed the units back. The sale is real; failing to decrement `stock` here
  // is what sells the same bar twice (spec user story 24).
  const { t, productIds } = await setup([{ stock: 10 }]);
  const reservationId = await reserve(t, [{ slug: "bar-0", qty: 2 }]);
  await t.mutation(api.checkout.releaseReservation, { reservationId });
  expect(await readProduct(t, productIds[0])).toMatchObject({
    stock: 10,
    reserved: 0,
  });

  await t.mutation(internal.orders.recordCheckoutCompleted, completedArgs());

  expect(await readProduct(t, productIds[0])).toMatchObject({
    stock: 8,
    // Untouched: the release already gave this back, so taking it again would
    // push the counter below what other checkouts hold.
    reserved: 0,
  });
  expect(await t.run(async (ctx) => await ctx.db.get(reservationId))).toMatchObject(
    { status: "committed" },
  );
  expect(await readOrders(t)).toHaveLength(1);
});

test("a refund marks the order refunded and restocks nothing", async () => {
  const { t, productIds } = await setup([{ stock: 10 }]);
  await reserve(t, [{ slug: "bar-0", qty: 2 }]);
  await t.mutation(internal.orders.recordCheckoutCompleted, completedArgs());

  await t.mutation(internal.orders.recordChargeRefunded, {
    eventId: "evt_refund_1",
    paymentIntentId: "pi_test_123",
  });

  expect((await readOrders(t))[0].status).toBe("refunded");
  // Deliberate: whether a refunded unit is resellable is the Admin's call
  // (spec user story 32).
  expect(await readProduct(t, productIds[0])).toMatchObject({
    stock: 8,
    reserved: 0,
  });
});

test("a redelivered refund does not overwrite what the Admin did next", async () => {
  const { t } = await setup([{ stock: 10 }]);
  await reserve(t, [{ slug: "bar-0", qty: 2 }]);
  await t.mutation(internal.orders.recordCheckoutCompleted, completedArgs());
  const refund = { eventId: "evt_refund_1", paymentIntentId: "pi_test_123" };
  await t.mutation(internal.orders.recordChargeRefunded, refund);
  // The Admin writes the order off afterwards (ticket 09).
  const orderId = (await readOrders(t))[0]._id;
  await t.run(async (ctx) => {
    await ctx.db.patch(orderId, { status: "cancelled" });
  });

  await t.mutation(internal.orders.recordChargeRefunded, refund);

  expect((await readOrders(t))[0].status).toBe("cancelled");
  expect(await readEvents(t)).toHaveLength(2);
});

test("a refund for a payment we have no order for changes nothing", async () => {
  const { t } = await setup();

  await t.mutation(internal.orders.recordChargeRefunded, {
    eventId: "evt_refund_1",
    paymentIntentId: "pi_unknown",
  });

  expect(await readOrders(t)).toHaveLength(0);
  // Still recorded, so a retry of the same delivery stops here too.
  expect(await readEvents(t)).toMatchObject([
    { eventId: "evt_refund_1", type: "charge.refunded" },
  ]);
});

// --- The HTTP endpoint ------------------------------------------------------
// Stripe's signature is mocked here (Seam 2 signs for real); what these pin
// down is the routing, the dispatch, and the status code Stripe sees.

function stripeEvent(type: string, object: unknown, id = "evt_http_1") {
  return { id, type, data: { object } };
}

const COMPLETED_SESSION = {
  id: "cs_test_123",
  payment_intent: "pi_test_123",
  amount_subtotal: 998,
  amount_total: 1498,
  total_details: { amount_shipping: 500, amount_tax: 0 },
  customer_details: { email: "ada@example.com" },
  collected_information: {
    shipping_details: {
      name: "Ada Lovelace",
      address: {
        line1: "1 Analytical Way",
        line2: null,
        city: "Tucson",
        state: "AZ",
        postal_code: "85701",
        country: "US",
      },
    },
  },
};

async function post(
  t: ReturnType<typeof convexTest>,
  body: unknown,
  headers: Record<string, string> = { "stripe-signature": "t=1,v1=whatever" },
) {
  return await t.fetch("/stripe/webhook", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

test("a signed checkout.session.completed is applied and answered 200", async () => {
  const { t, productIds } = await setup([{ stock: 10 }]);
  await reserve(t, [{ slug: "bar-0", qty: 2 }]);
  const event = stripeEvent("checkout.session.completed", COMPLETED_SESSION);
  stripe.webhooks.constructEventAsync.mockResolvedValue(event);

  const response = await post(t, event);

  expect(response.status).toBe(200);
  expect(await readOrders(t)).toMatchObject([
    {
      email: "ada@example.com",
      totalCents: 1498,
      shippingCents: 500,
      shippingAddress: SHIPPING_ADDRESS,
    },
  ]);
  expect(await readProduct(t, productIds[0])).toMatchObject({ stock: 8 });
});

test("a tampered payload is refused and nothing is written", async () => {
  const { t, productIds } = await setup([{ stock: 10 }]);
  await reserve(t, [{ slug: "bar-0", qty: 2 }]);
  stripe.webhooks.constructEventAsync.mockRejectedValue(
    new Error("No signatures found matching the expected signature"),
  );

  const response = await post(
    t,
    stripeEvent("checkout.session.completed", COMPLETED_SESSION),
  );

  expect(response.status).toBe(400);
  expect(await readOrders(t)).toHaveLength(0);
  expect(await readProduct(t, productIds[0])).toMatchObject({
    stock: 10,
    reserved: 2,
  });
});

test("a request with no signature header never reaches Stripe", async () => {
  const { t } = await setup();

  const response = await post(
    t,
    stripeEvent("checkout.session.completed", COMPLETED_SESSION),
    {},
  );

  expect(response.status).toBe(400);
  expect(stripe.webhooks.constructEventAsync).not.toHaveBeenCalled();
});

test("an event type we do not handle is still answered 200", async () => {
  const { t } = await setup();
  const event = stripeEvent("payment_intent.created", { id: "pi_test_123" });
  stripe.webhooks.constructEventAsync.mockResolvedValue(event);

  const response = await post(t, event);

  expect(response.status).toBe(200);
  expect(await readEvents(t)).toHaveLength(0);
});

test("the raw body, not a reparsed one, is what gets verified", async () => {
  const { t } = await setup();
  const event = stripeEvent("checkout.session.expired", { id: "cs_test_123" });
  stripe.webhooks.constructEventAsync.mockResolvedValue(event);
  // Whitespace a `JSON.parse`/`stringify` round trip would silently drop —
  // and with it the signature (the gotcha `webhook.seam2.test.ts` proves for
  // real against Stripe).
  const rawBody = `{"id":"evt_http_1", "type":"checkout.session.expired"}`;

  await t.fetch("/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=whatever" },
    body: rawBody,
  });

  expect(stripe.webhooks.constructEventAsync.mock.calls[0].slice(0, 3)).toEqual([
    rawBody,
    "t=1,v1=whatever",
    "whsec_fake",
  ]);
});
