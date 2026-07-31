import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Exported so the webhook's mutation args derive from the stored shape rather
// than restating it (`orders.ts`) — one edit adds a field, not three.
// The four states an order can be in. Exported for the same reason as the
// address below: `/admin`'s status filter and its mutations validate against
// the stored union rather than restating it.
export const orderStatusValidator = v.union(
  v.literal("paid"),
  v.literal("shipped"),
  v.literal("refunded"),
  v.literal("cancelled"),
);

// One line of an order's snapshot — the name and price as they were at time of
// sale, never re-read from `products` (CONTEXT.md "Order").
export const orderItemValidator = v.object({
  productId: v.id("products"),
  name: v.string(),
  unitPriceCents: v.number(),
  qty: v.number(),
});

export const shippingAddressValidator = v.object({
  name: v.string(),
  line1: v.string(),
  line2: v.optional(v.string()),
  city: v.string(),
  state: v.string(),
  postalCode: v.string(),
  country: v.string(),
});

export default defineSchema({
  products: defineTable({
    slug: v.string(), // URL key, unique
    name: v.string(),
    description: v.string(), // markdown allowed
    priceCents: v.number(), // canonical price, USD cents
    compareAtCents: v.optional(v.number()), // for strikethrough pricing
    imageIds: v.array(v.id("_storage")), // Convex file storage
    stock: v.number(), // physical on-hand
    reserved: v.number(), // held by in-flight checkouts
    active: v.boolean(), // visible in storefront
    sortOrder: v.number(),

    // Stripe mirror
    stripeProductId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    syncStatus: v.union(
      v.literal("pending"),
      v.literal("synced"),
      v.literal("error"),
    ),
    syncError: v.optional(v.string()),
  })
    .index("by_slug", ["slug"])
    .index("by_active", ["active", "sortOrder"]),

  reservations: defineTable({
    // Optional because the reservation is written *before* the Stripe session
    // exists: stock is held first, then the session is created, then this is
    // attached (masterplan §5.1 — "reserve first, release on Stripe failure").
    // A row that never gets one is a session Stripe refused; the sweeper
    // (ticket 07) releases it.
    stripeSessionId: v.optional(v.string()),
    // Priced at reserve time, because that is the price Stripe charges: the
    // session holds the `stripePriceId` captured then, so an Admin price change
    // during the 30-minute hold does not follow the shopper. The webhook copies
    // these straight onto the order (ticket 06) rather than re-reading the
    // product, which by then may say something else.
    //
    // `name`/`unitPriceCents` are optional only so rows written before ticket 06
    // still validate; `reserveCart` always writes them, and the webhook falls
    // back to the product doc for the older rows.
    items: v.array(
      v.object({
        productId: v.id("products"),
        qty: v.number(),
        name: v.optional(v.string()),
        unitPriceCents: v.optional(v.number()),
      }),
    ),
    expiresAt: v.number(), // epoch ms
    status: v.union(
      v.literal("held"),
      v.literal("committed"),
      v.literal("released"),
    ),
  })
    .index("by_session", ["stripeSessionId"])
    .index("by_status_expiry", ["status", "expiresAt"]),

  orders: defineTable({
    stripeSessionId: v.string(),
    stripePaymentIntentId: v.optional(v.string()),
    email: v.string(),
    // snapshot — never join back to products for historical display
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
  })
    .index("by_status", ["status"])
    .index("by_session", ["stripeSessionId"])
    // How `charge.refunded` finds the order: a refund event names the payment
    // intent, never the checkout session (masterplan §5.2).
    .index("by_payment_intent", ["stripePaymentIntentId"]),

  stripeEvents: defineTable({
    eventId: v.string(), // idempotency guard
    type: v.string(),
    processedAt: v.number(),
  }).index("by_event", ["eventId"]),

  // Singleton row — see ADR-0004. Read live by createCheckoutSession;
  // editable from /admin Settings without a Stripe Dashboard trip or a redeploy.
  settings: defineTable({
    taxEnabled: v.boolean(), // default false, see masterplan §8.1
    shippingFlatRateCents: v.number(), // default 500 ($5.00 placeholder)
    freeShippingThresholdCents: v.number(), // default 2500 ($25.00)
    contactEmail: v.string(),
  }),
});
