import { describe, expect, test } from "vitest";
import {
  buildSessionParams,
  parseCheckoutItems,
  shippingOptionFor,
  type ReservationQuote,
} from "./checkout";

// Seam 1 for the settings-driven half of checkout: which shipping option and
// tax setting a given subtotal produces, and what the Stripe session
// parameters look like. Pure, so no Convex or Stripe involved.

const SETTINGS: ReservationQuote["settings"] = {
  taxEnabled: false,
  shippingFlatRateCents: 500,
  freeShippingThresholdCents: 2500,
};

function quote(overrides: Partial<ReservationQuote> = {}): ReservationQuote {
  return {
    reservationId: "reservation-1",
    expiresAt: Date.parse("2026-07-27T12:31:00.500Z"),
    subtotalCents: 1000,
    lines: [
      {
        slug: "cacao-crunch",
        name: "Cacao Crunch",
        qty: 2,
        unitPriceCents: 500,
        stripePriceId: "price_cacao",
      },
    ],
    settings: SETTINGS,
    ...overrides,
  };
}

describe("shippingOptionFor", () => {
  test("charges the flat rate just under the free-shipping threshold", () => {
    expect(shippingOptionFor(2499, SETTINGS)).toEqual({
      shipping_rate_data: {
        type: "fixed_amount",
        display_name: "Standard shipping",
        fixed_amount: { amount: 500, currency: "usd" },
        tax_behavior: "exclusive",
      },
    });
  });

  test("ships free exactly at the threshold", () => {
    expect(shippingOptionFor(2500, SETTINGS)).toMatchObject({
      shipping_rate_data: {
        display_name: "Free shipping",
        fixed_amount: { amount: 0, currency: "usd" },
      },
    });
  });

  test("ships free above the threshold", () => {
    expect(shippingOptionFor(2501, SETTINGS)).toMatchObject({
      shipping_rate_data: { fixed_amount: { amount: 0, currency: "usd" } },
    });
  });

  test("a zero threshold means everything ships free", () => {
    expect(
      shippingOptionFor(1, { ...SETTINGS, freeShippingThresholdCents: 0 }),
    ).toMatchObject({
      shipping_rate_data: { fixed_amount: { amount: 0, currency: "usd" } },
    });
  });

  test("the flat rate comes from settings, not a hardcoded amount", () => {
    expect(
      shippingOptionFor(1000, { ...SETTINGS, shippingFlatRateCents: 795 }),
    ).toMatchObject({
      shipping_rate_data: { fixed_amount: { amount: 795, currency: "usd" } },
    });
  });
});

describe("buildSessionParams", () => {
  test("builds an embedded session against the mirrored Stripe Prices", () => {
    const params = buildSessionParams(quote(), "https://all2beat.com");

    expect(params).toMatchObject({
      ui_mode: "embedded_page",
      mode: "payment",
      line_items: [{ price: "price_cacao", quantity: 2 }],
      shipping_address_collection: { allowed_countries: ["US"] },
      metadata: { reservationId: "reservation-1" },
      return_url:
        "https://all2beat.com/checkout/return?session_id={CHECKOUT_SESSION_ID}",
    });
    // Embedded mode's contract — no hosted-redirect URLs (ADR-0003).
    expect(params).not.toHaveProperty("success_url");
    expect(params).not.toHaveProperty("cancel_url");
  });

  test("expires with the reservation, in whole seconds", () => {
    const expiresAt = Date.parse("2026-07-27T12:31:00.500Z");

    expect(buildSessionParams(quote({ expiresAt }), "http://localhost:3000"))
      .toMatchObject({ expires_at: Math.floor(expiresAt / 1000) });
  });

  test("tax follows the settings flag when it is off", () => {
    expect(buildSessionParams(quote(), "https://all2beat.com")).toMatchObject({
      automatic_tax: { enabled: false },
    });
  });

  test("tax follows the settings flag when it is on", () => {
    const withTax = quote({ settings: { ...SETTINGS, taxEnabled: true } });

    expect(buildSessionParams(withTax, "https://all2beat.com")).toMatchObject({
      automatic_tax: { enabled: true },
    });
  });

  test("attaches exactly one shipping option, computed from the subtotal", () => {
    const params = buildSessionParams(
      quote({ subtotalCents: 3000 }),
      "https://all2beat.com",
    );

    // Stripe cannot pick between options by cart total, so the choice is made
    // here and only the winner is attached (masterplan §5.4).
    expect(params.shipping_options).toHaveLength(1);
    expect(params.shipping_options?.[0]).toMatchObject({
      shipping_rate_data: { fixed_amount: { amount: 0 } },
    });
  });
});

describe("parseCheckoutItems", () => {
  test("accepts a well-formed cart", () => {
    expect(
      parseCheckoutItems([
        { slug: "cacao-crunch", qty: 2 },
        { slug: "almond-fig", qty: 1 },
      ]),
    ).toEqual([
      { slug: "cacao-crunch", qty: 2 },
      { slug: "almond-fig", qty: 1 },
    ]);
  });

  test("keeps only slug and qty, dropping anything else sent along", () => {
    expect(
      parseCheckoutItems([
        { slug: "cacao-crunch", qty: 1, priceCents: 1 },
      ]),
    ).toEqual([{ slug: "cacao-crunch", qty: 1 }]);
  });

  test("an empty cart is well-formed — the caller decides what to do with it", () => {
    expect(parseCheckoutItems([])).toEqual([]);
  });

  test.each([
    ["not an array", "cacao-crunch"],
    ["a null entry", [null]],
    ["a missing slug", [{ qty: 1 }]],
    ["an empty slug", [{ slug: "", qty: 1 }]],
    ["a zero quantity", [{ slug: "cacao-crunch", qty: 0 }]],
    ["a negative quantity", [{ slug: "cacao-crunch", qty: -1 }]],
    ["a fractional quantity", [{ slug: "cacao-crunch", qty: 1.5 }]],
    ["a quantity over the per-line cap", [{ slug: "cacao-crunch", qty: 100 }]],
    [
      "a duplicated slug",
      [
        { slug: "cacao-crunch", qty: 1 },
        { slug: "cacao-crunch", qty: 1 },
      ],
    ],
  ])("rejects the whole payload for %s", (_case, input) => {
    expect(parseCheckoutItems(input)).toBeNull();
  });

  test("rejects a payload with more lines than the store has products", () => {
    const tooMany = Array.from({ length: 51 }, (_, index) => ({
      slug: `bar-${index}`,
      qty: 1,
    }));

    expect(parseCheckoutItems(tooMany)).toBeNull();
  });
});
