import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { releaseHeldReservation } from "./checkout";
import { requireAdmin } from "./authz";
import {
  orderItemValidator,
  orderStatusValidator,
  shippingAddressValidator,
} from "./schema";

// Orders have exactly two writers: Stripe, through the webhook mutations in the
// first half of this file, and the store owner, through the admin functions in
// the second (ticket 09).

// --- Stripe webhook deliveries -------------------------------------------
//
// What a verified Stripe webhook delivery does to our tables (masterplan §5.2).
// The HTTP endpoint itself is `http.ts`: it verifies the signature and pulls
// the handful of fields below out of the Stripe object, so everything here is
// plain data and every rule is a transaction — which is the point. A webhook
// handler cannot be atomic across `runMutation` calls, so each event is applied
// by exactly one mutation, idempotency guard included.

// Stripe retries, and it retries the *same* event id — so the first thing any
// handler does is claim that id. Returns false if this delivery has been seen,
// in which case the caller must do nothing at all (masterplan §11.3: a
// double-processed `checkout.session.completed` silently corrupts inventory).
//
// Safe as a read-then-insert because it runs inside a Convex mutation: two
// concurrent deliveries of one event serialise, and the loser is retried
// against the winner's row.
async function claimEvent(
  ctx: MutationCtx,
  eventId: string,
  type: string,
): Promise<boolean> {
  const seen = await ctx.db
    .query("stripeEvents")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .unique();
  if (seen !== null) {
    return false;
  }
  await ctx.db.insert("stripeEvents", {
    eventId,
    type,
    processedAt: Date.now(),
  });
  return true;
}

// The session id is the link back to the hold this payment was taken against —
// written by `checkout.attachSession` the moment Stripe handed one back.
async function reservationForSession(
  ctx: MutationCtx,
  stripeSessionId: string,
): Promise<Doc<"reservations"> | null> {
  return await ctx.db
    .query("reservations")
    .withIndex("by_session", (q) => q.eq("stripeSessionId", stripeSessionId))
    .unique();
}

export const recordCheckoutCompleted = internalMutation({
  args: {
    eventId: v.string(),
    sessionId: v.string(),
    paymentIntentId: v.optional(v.string()),
    email: v.string(),
    subtotalCents: v.number(),
    shippingCents: v.number(),
    taxCents: v.number(),
    totalCents: v.number(),
    shippingAddress: shippingAddressValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!(await claimEvent(ctx, args.eventId, "checkout.session.completed"))) {
      return null;
    }

    // A *different* event id for a session already ordered — a resend from the
    // Dashboard, say. The guard above can't see that; the session can.
    const existing = await ctx.db
      .query("orders")
      .withIndex("by_session", (q) => q.eq("stripeSessionId", args.sessionId))
      .unique();
    if (existing !== null) {
      return null;
    }

    const reservation = await reservationForSession(ctx, args.sessionId);
    if (reservation === null) {
      // Money has changed hands: the order gets written either way. Losing the
      // line snapshot is bad; losing the sale would be worse, and the totals
      // and the Stripe payment link still reach /admin.
      console.error(
        `No reservation for completed session ${args.sessionId} — recording the order without a line snapshot`,
      );
    }

    // The prices the shopper was actually quoted and charged, snapshotted when
    // the hold was taken (see `schema.ts`) — never re-read from `products`,
    // which by now may say something else. The fallback covers reservation rows
    // written before that snapshot existed.
    const items = [];
    for (const item of reservation?.items ?? []) {
      if (item.name === undefined || item.unitPriceCents === undefined) {
        // Fidelity is dropping — the live product is the best guess left, and
        // its price may have moved since the sale. Said out loud because an
        // order whose lines don't add up to `subtotalCents` otherwise looks
        // like a pricing bug in /admin rather than a stale reservation row.
        console.error(
          `Reservation ${reservation?._id} predates the priced line snapshot — falling back to the live product for session ${args.sessionId}`,
        );
      }
      const product = await ctx.db.get(item.productId);
      items.push({
        productId: item.productId,
        name: item.name ?? product?.name ?? "Unknown product",
        unitPriceCents: item.unitPriceCents ?? product?.priceCents ?? 0,
        qty: item.qty,
      });
    }

    await ctx.db.insert("orders", {
      stripeSessionId: args.sessionId,
      stripePaymentIntentId: args.paymentIntentId,
      email: args.email,
      items,
      subtotalCents: args.subtotalCents,
      shippingCents: args.shippingCents,
      taxCents: args.taxCents,
      totalCents: args.totalCents,
      shippingAddress: args.shippingAddress,
      status: "paid",
      paidAt: Date.now(),
    });

    // Only now does stock actually leave the shelf (masterplan §5.2).
    if (reservation === null || reservation.status === "committed") {
      // Already committed: these units have moved once and must not move again.
      return null;
    }
    // A `released` hold is the sweeper/`expired` race — the session's expiry and
    // the reservation's are the same instant, so a payment taken a moment before
    // it can be delivered a moment after the hold was handed back. The sale is
    // real either way and the units must still leave `stock`; `reserved` is the
    // only counter the release already corrected, so it is the only one skipped.
    const heldReserved = reservation.status === "held";
    await ctx.db.patch(reservation._id, { status: "committed" });
    for (const item of reservation.items) {
      const product = await ctx.db.get(item.productId);
      if (product === null) {
        continue;
      }
      await ctx.db.patch(item.productId, {
        stock: Math.max(0, product.stock - item.qty),
        ...(heldReserved
          ? { reserved: Math.max(0, product.reserved - item.qty) }
          : {}),
      });
    }
    return null;
  },
});

// The session ran out its 30 minutes unpaid. The hold goes back; stock never
// moved, so there is nothing to restore there. Overlaps with the sweeper
// (ticket 07) by design — whichever arrives first does the work.
export const recordCheckoutExpired = internalMutation({
  args: { eventId: v.string(), sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!(await claimEvent(ctx, args.eventId, "checkout.session.expired"))) {
      return null;
    }
    const reservation = await reservationForSession(ctx, args.sessionId);
    if (reservation === null) {
      return null;
    }
    // Stripe can deliver `expired` after `completed`; `releaseHeldReservation`
    // ignores anything not still `held`, so the sale wins.
    await releaseHeldReservation(ctx, reservation);
    return null;
  },
});

// A refund issued from the Stripe Dashboard, reflected here so the Admin isn't
// keeping two systems in step by hand (spec user story 31). Deliberately does
// **not** restock: whether a refunded unit is resellable is the Admin's call
// (story 32).
export const recordChargeRefunded = internalMutation({
  args: { eventId: v.string(), paymentIntentId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!(await claimEvent(ctx, args.eventId, "charge.refunded"))) {
      return null;
    }
    // By payment intent, not session: a refund event names the charge's intent
    // and knows nothing about the checkout that created it.
    //
    // `.first()`, not the `.unique()` used everywhere else: one intent should
    // only ever have one order, but `.unique()` throws when it doesn't, and a
    // throw here means a 500 and an endlessly retried delivery. Reflecting the
    // refund on the oldest matching order beats jamming Stripe's queue.
    const order = await ctx.db
      .query("orders")
      .withIndex("by_payment_intent", (q) =>
        q.eq("stripePaymentIntentId", args.paymentIntentId),
      )
      .first();
    if (order === null) {
      // A payment taken outside this storefront, or one whose order write
      // failed. Nothing to reflect.
      return null;
    }
    await ctx.db.patch(order._id, { status: "refunded" });
    return null;
  },
});

// --- /admin Orders (ticket 09) --------------------------------------------
//
// The store owner's daily triage view. Every function here opens with
// `requireAdmin` (ticket 08): orders carry customer names, addresses, and
// emails, so the read paths are guarded exactly as tightly as the writes.

// A ~5-SKU store doing low volume will not outrun this for a long time, and a
// bounded read keeps the list a single cheap query rather than a paginator the
// owner has to click through. When it does start truncating, the fix is
// `usePaginatedQuery`, not a bigger number.
export const MAX_ORDERS_LISTED = 200;

const orderSummaryValidator = v.object({
  _id: v.id("orders"),
  paidAt: v.number(),
  email: v.string(),
  totalCents: v.number(),
  status: orderStatusValidator,
  trackingNumber: v.optional(v.string()),
  // Enough to recognise the order in a list; the full priced snapshot is on
  // the detail screen.
  items: v.array(v.object({ name: v.string(), qty: v.number() })),
});

/**
 * The orders list, newest first, optionally narrowed to one status.
 *
 * Ordered by `_creationTime` rather than `paidAt` — they are written in the
 * same mutation and so agree, and only the former is an index Convex can walk
 * backwards. The status filter rides the `by_status` index, whose trailing
 * `_creationTime` column gives newest-first within a status for free.
 */
export const list = query({
  args: { status: v.optional(orderStatusValidator) },
  returns: v.array(orderSummaryValidator),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const status = args.status;
    const rows = await (
      status === undefined
        ? ctx.db.query("orders")
        : ctx.db.query("orders").withIndex("by_status", (q) => q.eq("status", status))
    )
      .order("desc")
      .take(MAX_ORDERS_LISTED);

    return rows.map((order) => ({
      _id: order._id,
      paidAt: order.paidAt,
      email: order.email,
      totalCents: order.totalCents,
      status: order.status,
      trackingNumber: order.trackingNumber,
      items: order.items.map((item) => ({ name: item.name, qty: item.qty })),
    }));
  },
});

// Which half of Stripe an order lives in isn't recoverable from a payment
// intent id, so it comes from the key this deployment talks to Stripe with.
// Defaulting to live mode when the key is absent is the harmless direction: a
// live link opened from a test deployment 404s in the Dashboard, whereas a
// /test/ link to a real payment would look like the payment had vanished.
function stripePaymentUrl(paymentIntentId: string | undefined): string | null {
  if (paymentIntentId === undefined) {
    return null;
  }
  const testMode = process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ?? false;
  return `https://dashboard.stripe.com/${testMode ? "test/" : ""}payments/${paymentIntentId}`;
}

/**
 * One order, with everything needed to fulfill it.
 *
 * Takes the id as a string and normalizes it rather than declaring
 * `v.id("orders")`: the caller is a URL path segment, and a mistyped one
 * should render "order not found" instead of throwing an argument-validation
 * error at the screen.
 */
export const get = query({
  args: { orderId: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("orders"),
      _creationTime: v.number(),
      stripeSessionId: v.string(),
      stripePaymentIntentId: v.optional(v.string()),
      // The link out to the matching payment, built here because only the
      // server knows which Stripe mode this deployment is pointed at.
      stripePaymentUrl: v.union(v.string(), v.null()),
      email: v.string(),
      items: v.array(orderItemValidator),
      subtotalCents: v.number(),
      shippingCents: v.number(),
      taxCents: v.number(),
      totalCents: v.number(),
      shippingAddress: shippingAddressValidator,
      status: orderStatusValidator,
      trackingNumber: v.optional(v.string()),
      notes: v.optional(v.string()),
      paidAt: v.number(),
      shippedAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const orderId = ctx.db.normalizeId("orders", args.orderId);
    if (orderId === null) {
      return null;
    }
    const order = await ctx.db.get(orderId);
    if (order === null) {
      return null;
    }
    return {
      ...order,
      stripePaymentUrl: stripePaymentUrl(order.stripePaymentIntentId),
    };
  },
});

// An empty box means "no tracking number" / "no note", not the empty string.
function trimmedOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

async function requireOrder(ctx: MutationCtx, orderId: string) {
  await requireAdmin(ctx);
  const id = ctx.db.normalizeId("orders", orderId);
  const order = id === null ? null : await ctx.db.get(id);
  if (order === null) {
    throw new Error("No such order");
  }
  return order;
}

/**
 * Records fulfillment: status `shipped`, `shippedAt`, and an optional tracking
 * number (spec user story 29).
 *
 * Re-marking an already-shipped order is allowed — it is how a mistyped
 * tracking number gets fixed — and keeps the original `shippedAt`, because the
 * correction is not a second shipment. A refunded or cancelled order is
 * refused: shipping it would overwrite a status the Stripe Dashboard is the
 * source of truth for (story 31), silently undoing the refund in these records.
 */
export const markShipped = mutation({
  args: { orderId: v.string(), trackingNumber: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const order = await requireOrder(ctx, args.orderId);
    if (order.status === "refunded" || order.status === "cancelled") {
      throw new Error(`Cannot mark a ${order.status} order shipped`);
    }
    await ctx.db.patch(order._id, {
      status: "shipped",
      shippedAt: order.shippedAt ?? Date.now(),
      trackingNumber: trimmedOrUndefined(args.trackingNumber),
    });
    return null;
  },
});

// The internal note (story 30) — one editable field on the order, never shown
// to the customer. Saving an empty box clears it.
export const saveNote = mutation({
  args: { orderId: v.string(), note: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const order = await requireOrder(ctx, args.orderId);
    await ctx.db.patch(order._id, { notes: trimmedOrUndefined(args.note) });
    return null;
  },
});
