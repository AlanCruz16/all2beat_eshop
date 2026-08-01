import { v, type Infer } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAdmin } from "./authz";
import { reject, requireCount } from "./adminInput";
import { settingsValidator } from "./schema";

export const DEFAULT_SETTINGS: Infer<typeof settingsValidator> = {
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

// --- /admin Settings (ticket 11) ------------------------------------------
//
// There is no admin-only *read* here: `get` above is already public, because
// the storefront needs three of these four (the contact page prints the email,
// the cart counts up to the free-shipping threshold) and the fourth is a
// boolean about tax. The write is another matter entirely.

// Deliberately loose — the point is to catch a half-typed address or a stray
// sentence, not to adjudicate RFC 5322. This value is printed on the contact
// page, so an obviously-broken one is worth refusing at the form.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The Settings form's save (spec stories 25, 38, 39, 40).
 *
 * Takes all four values every time rather than a patch of what changed: the
 * screen is one form with one button, and a whole-form write can't leave the
 * row half-updated by a partially-applied patch.
 *
 * The write lands on the singleton, inserting it if a deployment was never
 * seeded — otherwise the one screen able to supply all four values would be
 * unable to fix a store that `reserveCart` is already refusing for want of a
 * settings row.
 *
 * Nothing here touches Stripe. The amounts reach it as dynamic
 * `shipping_rate_data` built per session from this row (ADR-0004), and the tax
 * flag as `automatic_tax.enabled` — which is why the next checkout reflects a
 * change with no Dashboard trip and no redeploy.
 */
export const save = mutation({
  args: settingsValidator.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    // Zero is allowed on both and means something: a flat rate of zero is free
    // shipping on every order, and a threshold of zero is what
    // `shippingOptionFor` already reads as "always free".
    requireCount("Shipping rate", args.shippingFlatRateCents, 0);
    requireCount("Free-shipping threshold", args.freeShippingThresholdCents, 0);

    const contactEmail = args.contactEmail.trim();
    if (!EMAIL_REGEX.test(contactEmail)) {
      reject(
        `"${contactEmail}" isn't an email address — customers are told to write to it, so it has to be one`,
      );
    }

    const fields = {
      taxEnabled: args.taxEnabled,
      shippingFlatRateCents: args.shippingFlatRateCents,
      freeShippingThresholdCents: args.freeShippingThresholdCents,
      contactEmail,
    };

    const existing = await ctx.db.query("settings").first();
    if (existing === null) {
      await ctx.db.insert("settings", fields);
    } else {
      await ctx.db.patch(existing._id, fields);
    }
    return null;
  },
});
