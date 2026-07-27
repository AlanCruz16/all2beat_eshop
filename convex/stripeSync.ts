"use node";

// The Convex → Stripe product mirror (ADR-0001, masterplan §6).
//
// Its own file, and a Node action, for two reasons: the Stripe SDK's default
// client needs Node, and `"use node"` may not sit in a file that also exports
// queries or mutations. The webhook (ticket 06) deliberately does NOT live
// here — it needs the default Convex runtime for `constructEventAsync`.

import Stripe from "stripe";
import { v } from "convex/values";
import { env, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { ProductSyncView } from "./products";

const CURRENCY = "usd";

type MirrorIds = { stripeProductId?: string; stripePriceId?: string };

// The Stripe ids established so far, written down as the sync walks forward so
// that a failure halfway through still reports what was created — otherwise a
// retry would orphan the Stripe Product it already made and create a second
// one. Only ever read on the failure path; success reports its own ids.
type SyncProgress = MirrorIds;

// The fields Stripe mirrors. Everything else about a product (stock, images,
// sort order) is Convex's business alone. `description` is left out because
// create and update disagree about the empty string — see `syncToStripe`.
function productParams(product: ProductSyncView) {
  return {
    name: product.name,
    active: product.active,
    metadata: { convexProductId: product._id, slug: product.slug },
  };
}

// Stripe Prices are immutable: a price change means create-new,
// point-the-Product-at-it, archive-old — in that order, because Stripe
// refuses to archive a Product's default Price.
async function syncPrice(
  stripe: Stripe,
  product: ProductSyncView,
  stripeProductId: string,
  progress: SyncProgress,
): Promise<string> {
  // Convex records no copy of what Stripe currently charges, so the live Price
  // is what "did priceCents change?" is answered against. That also catches a
  // Price archived by hand in the Dashboard, which would otherwise leave the
  // product mirrored but unsellable.
  const current = progress.stripePriceId
    ? await stripe.prices.retrieve(progress.stripePriceId)
    : null;
  if (
    current !== null &&
    current.active &&
    current.currency === CURRENCY &&
    current.unit_amount === product.priceCents
  ) {
    return current.id;
  }

  const price = await stripe.prices.create({
    product: stripeProductId,
    currency: CURRENCY,
    unit_amount: product.priceCents,
  });
  await stripe.products.update(stripeProductId, { default_price: price.id });
  progress.stripePriceId = price.id;

  if (current !== null) {
    await stripe.prices.update(current.id, { active: false });
  }
  return price.id;
}

async function syncToStripe(
  stripe: Stripe,
  product: ProductSyncView,
  progress: SyncProgress,
): Promise<Required<MirrorIds>> {
  // Stripe rejects an empty description on create, but on update reads one as
  // "unset it" — so the field is conditional going in and unconditional after.
  const description = product.description.trim();
  let stripeProductId = progress.stripeProductId;
  if (stripeProductId === undefined) {
    const created = await stripe.products.create({
      ...productParams(product),
      ...(description === "" ? {} : { description }),
    });
    stripeProductId = created.id;
    progress.stripeProductId = created.id;
  } else {
    await stripe.products.update(stripeProductId, {
      ...productParams(product),
      description,
    });
  }
  return {
    stripeProductId,
    stripePriceId: await syncPrice(stripe, product, stripeProductId, progress),
  };
}

export const syncProduct = internalAction({
  args: { productId: v.id("products") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const product: ProductSyncView | null = await ctx.runQuery(
      internal.products.getForSync,
      { productId: args.productId },
    );
    if (product === null) {
      // Deleted between the write and the scheduled sync — nothing to mirror.
      return null;
    }

    const progress: SyncProgress = {
      stripeProductId: product.stripeProductId,
      stripePriceId: product.stripePriceId,
    };
    let synced: Required<MirrorIds>;
    try {
      const secretKey = env.STRIPE_SECRET_KEY;
      if (!secretKey) {
        throw new Error(
          "STRIPE_SECRET_KEY is not set on this Convex deployment",
        );
      }
      synced = await syncToStripe(new Stripe(secretKey), product, progress);
    } catch (error) {
      // A product left in `error` is surfaced as unsellable in /admin
      // (ticket 10) rather than silently selling against a stale mirror.
      await ctx.runMutation(internal.products.recordSyncError, {
        productId: args.productId,
        message: error instanceof Error ? error.message : String(error),
        ...progress,
      });
      return null;
    }

    await ctx.runMutation(internal.products.recordSyncSuccess, {
      productId: args.productId,
      ...synced,
    });
    return null;
  },
});
