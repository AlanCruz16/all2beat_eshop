import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
    items: v.array(v.object({ productId: v.id("products"), qty: v.number() })),
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
    items: v.array(
      v.object({
        productId: v.id("products"),
        name: v.string(),
        unitPriceCents: v.number(),
        qty: v.number(),
      }),
    ),
    subtotalCents: v.number(),
    shippingCents: v.number(),
    taxCents: v.number(),
    totalCents: v.number(),
    shippingAddress: v.object({
      name: v.string(),
      line1: v.string(),
      line2: v.optional(v.string()),
      city: v.string(),
      state: v.string(),
      postalCode: v.string(),
      country: v.string(),
    }),
    status: v.union(
      v.literal("paid"),
      v.literal("shipped"),
      v.literal("refunded"),
      v.literal("cancelled"),
    ),
    trackingNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
    paidAt: v.number(),
    shippedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_session", ["stripeSessionId"]),

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
