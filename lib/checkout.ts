import type Stripe from "stripe";
import { MAX_LINE_QTY, type CartLine } from "./cart";

// The pure half of checkout: what a well-formed request looks like, and what
// Stripe session parameters follow from a reservation plus the live `settings`
// row. No Stripe client, no Convex, no network — so the shipping and tax rules
// that decide what a shopper is charged are covered by ordinary unit tests.

const CURRENCY = "usd";

// Mirrors `products.MAX_CART_SLUGS` from the other side of the wire: the cart
// query caps how many products it will price, and this caps how many a single
// checkout request may name.
export const MAX_CHECKOUT_LINES = 50;

// The shape `buildSessionParams` needs from a reservation — structurally
// satisfied by `checkout.reserveCart`'s quote, without coupling this module to
// Convex (the same arrangement as `CatalogProduct` in `./cart`).
export type ReservationQuote = {
  reservationId: string;
  expiresAt: number;
  subtotalCents: number;
  lines: Array<{
    slug: string;
    name: string;
    qty: number;
    unitPriceCents: number;
    stripePriceId: string;
  }>;
  settings: {
    taxEnabled: boolean;
    shippingFlatRateCents: number;
    freeShippingThresholdCents: number;
  };
};

// Why one line of the cart can't be bought — mirrors
// `checkout.checkoutLineErrorValidator`. Structured rather than pre-formatted
// so the checkout UI owns the wording (masterplan §5.1 step 3).
export type CheckoutLineError = {
  slug: string;
  name?: string;
  reason: "unavailable" | "unsellable" | "insufficient-stock";
  availableQty: number;
};

export type CreateCheckoutSessionResult =
  | { ok: true; clientSecret: string }
  // `lineErrors` is empty when the failure isn't about a particular product —
  // an empty cart, a malformed payload, or Stripe being down.
  | { ok: false; message: string; lineErrors: CheckoutLineError[] };

// Validation at the trust boundary. Unlike `parseStoredCart` — which is
// forgiving because it reads the shopper's own possibly-stale storage — this
// rejects the whole payload rather than dropping bad lines: silently checking
// out a subset of what was sent would charge for a cart nobody assembled.
// Returns null for anything malformed; an empty array is well-formed and left
// for the caller to refuse.
export function parseCheckoutItems(input: unknown): CartLine[] | null {
  if (!Array.isArray(input) || input.length > MAX_CHECKOUT_LINES) {
    return null;
  }

  const lines: CartLine[] = [];
  for (const entry of input) {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }
    const { slug, qty } = entry as { slug?: unknown; qty?: unknown };
    if (typeof slug !== "string" || slug === "") {
      return null;
    }
    if (
      typeof qty !== "number" ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > MAX_LINE_QTY
    ) {
      return null;
    }
    if (lines.some((line) => line.slug === slug)) {
      return null;
    }
    lines.push({ slug, qty });
  }
  return lines;
}

// Stripe Checkout cannot pick a shipping rate from the cart total itself
// (masterplan §5.4), so exactly one option is decided here and attached to the
// session. Built as dynamic `shipping_rate_data` from the live `settings` row
// rather than a pre-created Stripe `shipping_rate` object, which is what makes
// the amounts editable from /admin without a Stripe trip or a deploy
// (ADR-0004).
export function shippingOptionFor(
  subtotalCents: number,
  settings: ReservationQuote["settings"],
): Stripe.Checkout.SessionCreateParams.ShippingOption {
  // A threshold of zero means everything ships free — a value the Admin can
  // legitimately save, and the same reading `freeShippingProgress` gives it.
  const free =
    settings.freeShippingThresholdCents <= 0 ||
    subtotalCents >= settings.freeShippingThresholdCents;
  return {
    shipping_rate_data: {
      type: "fixed_amount",
      display_name: free ? "Free shipping" : "Standard shipping",
      fixed_amount: {
        amount: free ? 0 : settings.shippingFlatRateCents,
        currency: CURRENCY,
      },
      // Stated rather than left unspecified so the amount above is what the
      // shopper is charged for shipping whether or not Stripe Tax is on; with
      // `automatic_tax` enabled, any tax is added on top.
      tax_behavior: "exclusive",
    },
  };
}

// Embedded mode (ADR-0003): `ui_mode: "embedded_page"` with a `return_url`,
// not the hosted-redirect `success_url`/`cancel_url` pair. Stripe substitutes
// the real id into the `{CHECKOUT_SESSION_ID}` placeholder.
export function buildSessionParams(
  quote: ReservationQuote,
  origin: string,
): Stripe.Checkout.SessionCreateParams {
  return {
    ui_mode: "embedded_page",
    mode: "payment",
    // Charged against the mirrored Stripe Price, never a price sent from the
    // client — see ADR-0001 and masterplan §5.1 step 1.
    line_items: quote.lines.map((line) => ({
      price: line.stripePriceId,
      quantity: line.qty,
    })),
    // Seconds, and deliberately the reservation's own expiry: the hold and the
    // session have to end together (see `RESERVATION_TTL_MS`).
    expires_at: Math.floor(quote.expiresAt / 1000),
    shipping_address_collection: { allowed_countries: ["US"] },
    shipping_options: [shippingOptionFor(quote.subtotalCents, quote.settings)],
    automatic_tax: { enabled: quote.settings.taxEnabled },
    // How the webhook (ticket 06) finds the stock this payment was holding.
    metadata: { reservationId: quote.reservationId },
    return_url: `${origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
  };
}
