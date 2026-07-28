import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { MAX_CART_SLUGS } from "./products";

// Reservations and the Stripe session must expire together, so this one number
// feeds both (masterplan §5.1). It also sits on Stripe's floor: `expires_at`
// must be at least 30 minutes out, measured when Stripe receives the request —
// so a timestamp computed here and sent a moment later is technically short.
// Stripe allows about a minute of slack for exactly that, which a Seam 2 test
// pins down (`lib/checkout.seam2.test.ts`) rather than leaving to inference.
export const RESERVATION_TTL_MS = 30 * 60_000;

// Why a line can't be bought right now. Each maps to a sentence the checkout UI
// renders; nothing else about the failure reaches the shopper.
export const checkoutLineErrorValidator = v.object({
  slug: v.string(),
  // The product's name where we have one — an unknown slug has none, and the
  // slug is then the only thing left to identify the line by.
  name: v.optional(v.string()),
  reason: v.union(
    // Unknown slug, or deactivated since it went in the cart.
    v.literal("unavailable"),
    // Real and active, but its Stripe mirror is missing or errored, so it has
    // no Price to sell against (ADR-0001).
    v.literal("unsellable"),
    v.literal("insufficient-stock"),
  ),
  // How many the shopper could actually buy. Only meaningful for
  // `insufficient-stock`; zero otherwise.
  availableQty: v.number(),
});

const reservedLineValidator = v.object({
  slug: v.string(),
  name: v.string(),
  qty: v.number(),
  unitPriceCents: v.number(),
  stripePriceId: v.string(),
});

// Everything the Stripe session needs, read in the same transaction that took
// the stock — so the prices charged, the shipping rule applied, and the units
// held can't have drifted apart between reads.
const reservationQuoteValidator = v.object({
  reservationId: v.id("reservations"),
  expiresAt: v.number(),
  subtotalCents: v.number(),
  lines: v.array(reservedLineValidator),
  settings: v.object({
    taxEnabled: v.boolean(),
    shippingFlatRateCents: v.number(),
    freeShippingThresholdCents: v.number(),
  }),
});

const reserveResultValidator = v.union(
  v.object({ ok: v.literal(true), quote: reservationQuoteValidator }),
  v.object({
    ok: v.literal(false),
    errors: v.array(checkoutLineErrorValidator),
  }),
);

function availableStock(product: Doc<"products">): number {
  return Math.max(0, product.stock - product.reserved);
}

// Steps 3 and 6 of masterplan §5.1 in one transaction: the stock check and the
// hold that acts on it. Splitting them would let two shoppers both pass the
// check on the last unit; a Convex mutation is a transaction, so the second
// caller either sees the first one's `reserved` or is retried against it.
//
// Public because the checkout Server Action reaches it over HTTP and has no
// admin credentials. That is the same exposure the Server Action itself has —
// an unauthenticated guest can start a checkout, by design — and the worst a
// caller achieves is holding stock for the TTL, which the sweeper (ticket 07)
// and Stripe's own session expiry both undo.
export const reserveCart = mutation({
  args: {
    items: v.array(v.object({ slug: v.string(), qty: v.number() })),
  },
  returns: reserveResultValidator,
  handler: async (ctx, args) => {
    // An operator problem, not a shopper one: without settings there is no
    // shipping rule or tax flag to price against (ADR-0004). Fail loudly
    // rather than quietly charging the wrong shipping.
    const settings = await ctx.db.query("settings").first();
    if (settings === null) {
      throw new Error(
        "No settings row — run `npm run seed:settings` before taking checkouts",
      );
    }

    // This mutation is reachable directly, so it re-checks the shape the
    // Server Action already normalised rather than trusting it.
    if (args.items.length === 0) {
      throw new Error("Cannot reserve an empty cart");
    }
    if (args.items.length > MAX_CART_SLUGS) {
      throw new Error(`Cannot reserve more than ${MAX_CART_SLUGS} lines`);
    }
    const slugs = new Set(args.items.map((item) => item.slug));
    if (slugs.size !== args.items.length) {
      throw new Error("Duplicate slugs in checkout items");
    }
    for (const item of args.items) {
      if (!Number.isInteger(item.qty) || item.qty < 1) {
        throw new Error(`Invalid quantity for ${item.slug}`);
      }
    }

    const errors: Array<{
      slug: string;
      name?: string;
      reason: "unavailable" | "unsellable" | "insufficient-stock";
      availableQty: number;
    }> = [];
    const reserved: Array<{
      product: Doc<"products">;
      qty: number;
      stripePriceId: string;
    }> = [];

    for (const item of args.items) {
      const product = await ctx.db
        .query("products")
        .withIndex("by_slug", (q) => q.eq("slug", item.slug))
        .unique();

      if (product === null || !product.active) {
        errors.push({
          slug: item.slug,
          reason: "unavailable",
          availableQty: 0,
        });
        continue;
      }
      // A product whose mirror never landed has no Price to charge against, so
      // it cannot be sold — the state ticket 10 surfaces in /admin (ADR-0001).
      if (product.syncStatus !== "synced" || product.stripePriceId === undefined) {
        errors.push({
          slug: item.slug,
          name: product.name,
          reason: "unsellable",
          availableQty: 0,
        });
        continue;
      }
      const available = availableStock(product);
      if (available < item.qty) {
        errors.push({
          slug: item.slug,
          name: product.name,
          reason: "insufficient-stock",
          availableQty: available,
        });
        continue;
      }
      reserved.push({
        product,
        qty: item.qty,
        stripePriceId: product.stripePriceId,
      });
    }

    // All or nothing: a partial reservation would charge for a cart the shopper
    // never agreed to. Nothing has been written at this point.
    if (errors.length > 0) {
      return { ok: false as const, errors };
    }

    const expiresAt = Date.now() + RESERVATION_TTL_MS;
    const reservationId = await ctx.db.insert("reservations", {
      // Priced here, not at commit time: this is the price the Stripe session
      // charges against, so it is the one the order must record (see the
      // `reservations` comment in `schema.ts`).
      items: reserved.map(({ product, qty }) => ({
        productId: product._id,
        qty,
        name: product.name,
        unitPriceCents: product.priceCents,
      })),
      expiresAt,
      status: "held",
    });
    for (const { product, qty } of reserved) {
      await ctx.db.patch(product._id, { reserved: product.reserved + qty });
    }

    return {
      ok: true as const,
      quote: {
        reservationId,
        expiresAt,
        subtotalCents: reserved.reduce(
          (total, { product, qty }) => total + product.priceCents * qty,
          0,
        ),
        lines: reserved.map(({ product, qty, stripePriceId }) => ({
          slug: product.slug,
          name: product.name,
          qty,
          unitPriceCents: product.priceCents,
          stripePriceId,
        })),
        settings: {
          taxEnabled: settings.taxEnabled,
          shippingFlatRateCents: settings.shippingFlatRateCents,
          freeShippingThresholdCents: settings.freeShippingThresholdCents,
        },
      },
    };
  },
});

// Closes the loop the moment Stripe hands back a session id, so the webhook
// (ticket 06) can find this reservation by session as well as by metadata.
export const attachSession = mutation({
  args: {
    reservationId: v.id("reservations"),
    stripeSessionId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    // Only a live hold gets a session id. A reservation already committed or
    // released has been settled by the webhook or the sweeper, and re-pointing
    // it at a session now would misattribute whatever they did.
    if (reservation === null || reservation.status !== "held") {
      return null;
    }
    await ctx.db.patch(args.reservationId, {
      stripeSessionId: args.stripeSessionId,
    });
    return null;
  },
});

// The rollback half of "reserve first, release on Stripe failure". Also safe to
// call for a shopper who abandons a session, though the sweeper covers that.
//
// Idempotent by design: the sweeper, the `checkout.session.expired` webhook and
// this can all reach the same row, and only the first of them may give the
// stock back. `held` is the guard that makes double-decrementing impossible.
export const releaseReservation = mutation({
  args: { reservationId: v.id("reservations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (reservation === null) {
      return null;
    }
    await releaseHeldReservation(ctx, reservation);
    return null;
  },
});

// One sweep is one transaction, so it has to stay well inside Convex's
// per-mutation read/write limits. At a store this size the expired backlog
// between two five-minute runs is a handful of rows; the cap only matters after
// an outage — and a full batch chains straight into another run rather than
// waiting five minutes, so a backlog never outlasts the "few minutes" the stock
// is promised back in.
export const SWEEP_BATCH_SIZE = 100;

// The safety net (masterplan §5.3): a shopper who starts a checkout and walks
// away must not lock up stock indefinitely. Stripe's `checkout.session.expired`
// usually gets there first, but it can be late, dropped, or never sent at all —
// for a session Stripe refused, no event exists to be sent. This owes nothing to
// those events and finds the rows by state alone.
export const sweepExpiredReservations = internalMutation({
  args: {},
  // Returned rather than logged so a run is observable — the cron's own history
  // shows how much each sweep actually had to release.
  returns: v.object({ released: v.number() }),
  handler: async (ctx) => {
    // `by_status_expiry` is what makes this cheap: the scan touches only held
    // rows already past their expiry, never the committed history behind them.
    const expired = await ctx.db
      .query("reservations")
      .withIndex("by_status_expiry", (q) =>
        q.eq("status", "held").lt("expiresAt", Date.now()),
      )
      .take(SWEEP_BATCH_SIZE);

    for (const reservation of expired) {
      await releaseHeldReservation(ctx, reservation);
    }

    // A full batch means there is probably more behind it. Chaining a fresh
    // transaction drains the backlog now instead of one batch per five minutes,
    // while keeping each transaction small.
    if (expired.length === SWEEP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.checkout.sweepExpiredReservations, {});
    }
    return { released: expired.length };
  },
});

// The one place a hold is given back, shared by the Stripe-failure rollback
// above, the `checkout.session.expired` webhook (`orders.ts`) and the sweeper
// (ticket 07) — three callers that can all reach the same row, of which only
// the first may move the counter. `held` is the guard that makes
// double-decrementing impossible, so it lives here rather than in each caller.
export async function releaseHeldReservation(
  ctx: MutationCtx,
  reservation: Doc<"reservations">,
): Promise<void> {
  if (reservation.status !== "held") {
    return;
  }
  await ctx.db.patch(reservation._id, { status: "released" });
  for (const item of reservation.items) {
    const product = await ctx.db.get(item.productId);
    if (product === null) {
      continue;
    }
    // Clamped because releasing must never manufacture negative reserve —
    // a product deleted and recreated, or hand-edited stock, shouldn't leave
    // the counter below zero.
    await ctx.db.patch(item.productId, {
      reserved: Math.max(0, product.reserved - item.qty),
    });
  }
}
