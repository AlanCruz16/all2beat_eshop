import { internalMutation, query } from "./_generated/server";

export const DEFAULT_SETTINGS = {
  taxEnabled: false,
  shippingFlatRateCents: 500,
  freeShippingThresholdCents: 2500,
  contactEmail: "hello@all2beat.com",
};

// The settings table is a singleton — always read/seed the first (only) row.
export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("settings").first();
  },
});

// Idempotent: does nothing if a settings row already exists, so this is safe
// to run repeatedly against the same deployment (ADR-0004).
export const seedDefaults = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("settings").first();
    if (existing !== null) {
      return existing._id;
    }
    return await ctx.db.insert("settings", DEFAULT_SETTINGS);
  },
});
