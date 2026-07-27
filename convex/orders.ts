import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { releaseHeldReservation } from "./checkout";
import { shippingAddressValidator } from "./schema";

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
