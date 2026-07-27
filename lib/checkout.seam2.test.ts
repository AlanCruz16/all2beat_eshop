import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildSessionParams, type ReservationQuote } from "./checkout";

// Seam 2 (spec "Testing Decisions"): no mocks. This calls Stripe's real
// test-mode API with the exact parameters `createCheckoutSession` sends, and
// exists to catch what `lib/checkout.test.ts` structurally cannot — a shape
// that is internally consistent but that Stripe rejects. Embedded mode,
// dynamic `shipping_rate_data`, and `automatic_tax` are all things we assert
// against a mock elsewhere and can only really confirm here.
//
// Run with `npm run test:seam2`. Needs a Stripe **test-mode** secret key in
// `.env.local`; skipped, not failed, without one.

const secretKey = process.env.STRIPE_SECRET_KEY;
const hasTestKey = secretKey !== undefined && secretKey.startsWith("sk_test_");

if (secretKey !== undefined && !hasTestKey) {
  // A live key here would create real Checkout Sessions against the store.
  throw new Error(
    "STRIPE_SECRET_KEY is not a test-mode key (sk_test_…). Refusing to run Seam 2 tests against live Stripe.",
  );
}

const SETTINGS: ReservationQuote["settings"] = {
  taxEnabled: false,
  shippingFlatRateCents: 500,
  freeShippingThresholdCents: 2500,
};

describe.skipIf(!hasTestKey)("Stripe accepts our checkout session shape", () => {
  const stripe = new Stripe(secretKey ?? "");
  // The mirror the product sync would have made (ADR-0001) — a real test-mode
  // Price, because `line_items` reference one by id and Stripe validates it.
  let priceId: string;
  let productId: string;

  beforeAll(async () => {
    const product = await stripe.products.create({
      name: "Seam 2 fixture — safe to archive",
    });
    productId = product.id;
    const price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: 499,
    });
    priceId = price.id;
  });

  afterAll(async () => {
    // Test-mode objects can't be deleted once used, only archived.
    if (productId !== undefined) {
      await stripe.products.update(productId, { active: false });
    }
  });

  function quote(overrides: Partial<ReservationQuote> = {}): ReservationQuote {
    return {
      reservationId: "seam2-reservation",
      expiresAt: Date.now() + 30 * 60_000,
      subtotalCents: 998,
      lines: [
        {
          slug: "cacao-crunch",
          name: "Cacao Crunch",
          qty: 2,
          unitPriceCents: 499,
          stripePriceId: priceId,
        },
      ],
      settings: SETTINGS,
      ...overrides,
    };
  }

  test("creates an embedded session with a dynamic flat shipping rate", async () => {
    const params = buildSessionParams(quote(), "https://example.com");

    const session = await stripe.checkout.sessions.create(params);

    expect(session.ui_mode).toBe("embedded_page");
    expect(session.status).toBe("open");
    // The contract the checkout page depends on: a client secret, not a URL.
    expect(session.client_secret).toEqual(expect.stringContaining("cs_test_"));
    expect(session.url).toBeNull();
    expect(session.metadata?.reservationId).toBe("seam2-reservation");
    expect(session.expires_at).toBe(params.expires_at);
  });

  test("creates an embedded session with the free-shipping option", async () => {
    // Above the threshold, so the $0 rate is the one attached.
    const session = await stripe.checkout.sessions.create(
      buildSessionParams(
        quote({ subtotalCents: 3000 }),
        "https://example.com",
      ),
    );

    expect(session.shipping_options).toHaveLength(1);
    expect(session.shipping_options?.[0].shipping_amount).toBe(0);
  });

  test("a 30-minute reservation clears Stripe's expires_at floor", async () => {
    // `RESERVATION_TTL_MS` is exactly Stripe's documented minimum, so the
    // timestamp is already a fraction short by the time the request lands.
    // This is the test that says whether that's survivable — Stripe allows
    // roughly a minute of slack, so it is. If that ever tightens, this fails
    // here rather than in production.
    const session = await stripe.checkout.sessions.create(
      buildSessionParams(
        quote({ expiresAt: Date.now() + 30 * 60_000 }),
        "https://example.com",
      ),
    );
    expect(session.status).toBe("open");

    // The floor is real, though — well under it is refused.
    await expect(
      stripe.checkout.sessions.create(
        buildSessionParams(
          quote({ expiresAt: Date.now() + 20 * 60_000 }),
          "https://example.com",
        ),
      ),
    ).rejects.toThrow(/expires_at/);
  });

  test("accepts automatic_tax when the settings flag is on", async () => {
    const params = buildSessionParams(
      quote({ settings: { ...SETTINGS, taxEnabled: true } }),
      "https://example.com",
    );

    try {
      const session = await stripe.checkout.sessions.create(params);
      expect(session.automatic_tax.enabled).toBe(true);
    } catch (error) {
      // Stripe Tax is a per-account setting the client turns on at launch
      // (spec "Out of Scope"), so a test account without it can't complete
      // this call. That specific refusal still proves the parameter shape is
      // understood — anything else is a real failure.
      if (
        error instanceof Stripe.errors.StripeInvalidRequestError &&
        /tax/i.test(error.message)
      ) {
        console.warn(
          `Stripe Tax is not activated on this test account; automatic_tax shape unverified: ${error.message}`,
        );
        return;
      }
      throw error;
    }
  });
});
