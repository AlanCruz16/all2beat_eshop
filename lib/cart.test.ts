import { describe, expect, test } from "vitest";
import {
  MAX_LINE_QTY,
  addLine,
  cartItemCount,
  freeShippingProgress,
  parseStoredCart,
  priceCart,
  removeLine,
  serializeCart,
  setLineQty,
  type CartLine,
  type CatalogProduct,
} from "./cart";

function product(
  slug: string,
  priceCents: number,
  overrides: Partial<CatalogProduct> = {},
): CatalogProduct {
  return {
    slug,
    name: slug,
    priceCents,
    imageUrls: [],
    availability: "in-stock",
    ...overrides,
  };
}

describe("addLine", () => {
  test("appends a new line at the end of the cart", () => {
    const lines = addLine(addLine([], "cacao-crunch", 1), "almond-fig", 2);

    expect(lines).toEqual([
      { slug: "cacao-crunch", qty: 1 },
      { slug: "almond-fig", qty: 2 },
    ]);
  });

  test("sums quantities when the product is already in the cart, keeping its position", () => {
    const lines = addLine(
      [
        { slug: "cacao-crunch", qty: 1 },
        { slug: "almond-fig", qty: 1 },
      ],
      "cacao-crunch",
      2,
    );

    expect(lines).toEqual([
      { slug: "cacao-crunch", qty: 3 },
      { slug: "almond-fig", qty: 1 },
    ]);
  });

  test("clamps a line to the maximum quantity", () => {
    const lines = addLine([{ slug: "cacao-crunch", qty: 5 }], "cacao-crunch", 999);

    expect(lines).toEqual([{ slug: "cacao-crunch", qty: MAX_LINE_QTY }]);
  });

  test("ignores non-positive quantities", () => {
    expect(addLine([], "cacao-crunch", 0)).toEqual([]);
    expect(addLine([], "cacao-crunch", -3)).toEqual([]);
  });

  test("does not mutate the input", () => {
    const before: CartLine[] = [{ slug: "cacao-crunch", qty: 1 }];
    addLine(before, "cacao-crunch", 1);

    expect(before).toEqual([{ slug: "cacao-crunch", qty: 1 }]);
  });
});

describe("setLineQty", () => {
  test("replaces the quantity of an existing line", () => {
    const lines = setLineQty([{ slug: "cacao-crunch", qty: 1 }], "cacao-crunch", 4);

    expect(lines).toEqual([{ slug: "cacao-crunch", qty: 4 }]);
  });

  test("removes the line when the quantity drops to zero or below", () => {
    const lines = [
      { slug: "cacao-crunch", qty: 1 },
      { slug: "almond-fig", qty: 2 },
    ];

    expect(setLineQty(lines, "cacao-crunch", 0)).toEqual([
      { slug: "almond-fig", qty: 2 },
    ]);
    expect(setLineQty(lines, "cacao-crunch", -1)).toEqual([
      { slug: "almond-fig", qty: 2 },
    ]);
  });

  test("clamps to the maximum quantity", () => {
    expect(setLineQty([{ slug: "cacao-crunch", qty: 1 }], "cacao-crunch", 500)).toEqual(
      [{ slug: "cacao-crunch", qty: MAX_LINE_QTY }],
    );
  });

  test("is a no-op for a slug that is not in the cart", () => {
    const lines = [{ slug: "cacao-crunch", qty: 1 }];

    expect(setLineQty(lines, "mixed-berry", 3)).toEqual(lines);
  });
});

describe("removeLine", () => {
  test("drops only the named line", () => {
    const lines = removeLine(
      [
        { slug: "cacao-crunch", qty: 1 },
        { slug: "almond-fig", qty: 2 },
      ],
      "cacao-crunch",
    );

    expect(lines).toEqual([{ slug: "almond-fig", qty: 2 }]);
  });
});

describe("cartItemCount", () => {
  test("sums quantities across lines", () => {
    expect(
      cartItemCount([
        { slug: "cacao-crunch", qty: 2 },
        { slug: "almond-fig", qty: 3 },
      ]),
    ).toBe(5);
  });

  test("is zero for an empty cart", () => {
    expect(cartItemCount([])).toBe(0);
  });
});

describe("parseStoredCart", () => {
  test("round-trips a serialized cart", () => {
    const lines: CartLine[] = [
      { slug: "cacao-crunch", qty: 2 },
      { slug: "almond-fig", qty: 1 },
    ];

    expect(parseStoredCart(serializeCart(lines))).toEqual(lines);
  });

  test("returns an empty cart for absent or unparseable storage", () => {
    expect(parseStoredCart(null)).toEqual([]);
    expect(parseStoredCart("")).toEqual([]);
    expect(parseStoredCart("not json")).toEqual([]);
    expect(parseStoredCart('{"slug":"cacao-crunch"}')).toEqual([]);
  });

  test("drops entries that are not a slug/quantity pair", () => {
    const raw = JSON.stringify([
      { slug: "cacao-crunch", qty: 2 },
      { slug: "", qty: 1 },
      { slug: "almond-fig", qty: 0 },
      { slug: "mixed-berry", qty: 1.5 },
      { slug: 7, qty: 1 },
      null,
      "coconut-cashew",
    ]);

    expect(parseStoredCart(raw)).toEqual([{ slug: "cacao-crunch", qty: 2 }]);
  });

  test("clamps stored quantities and de-duplicates slugs", () => {
    const raw = JSON.stringify([
      { slug: "cacao-crunch", qty: 10_000 },
      { slug: "cacao-crunch", qty: 1 },
    ]);

    expect(parseStoredCart(raw)).toEqual([
      { slug: "cacao-crunch", qty: MAX_LINE_QTY },
    ]);
  });

  test("ignores a stored price, so a stale price can never reach the cart", () => {
    const raw = JSON.stringify([
      { slug: "cacao-crunch", qty: 2, priceCents: 1 },
    ]);

    expect(parseStoredCart(raw)).toEqual([{ slug: "cacao-crunch", qty: 2 }]);
  });
});

describe("priceCart", () => {
  test("prices each line from the catalog, not from the cart", () => {
    const priced = priceCart([{ slug: "cacao-crunch", qty: 3 }], [
      product("cacao-crunch", 499, { name: "Cacao Crunch" }),
    ]);

    expect(priced.lines).toEqual([
      {
        slug: "cacao-crunch",
        qty: 3,
        name: "Cacao Crunch",
        unitPriceCents: 499,
        lineTotalCents: 1497,
        imageUrl: undefined,
        availability: "in-stock",
      },
    ]);
    expect(priced.subtotalCents).toBe(1497);
  });

  test("keeps cart order regardless of catalog order", () => {
    const priced = priceCart(
      [
        { slug: "almond-fig", qty: 1 },
        { slug: "cacao-crunch", qty: 1 },
      ],
      [product("cacao-crunch", 499), product("almond-fig", 599)],
    );

    expect(priced.lines.map((line) => line.slug)).toEqual([
      "almond-fig",
      "cacao-crunch",
    ]);
  });

  test("sums the subtotal across lines", () => {
    const priced = priceCart(
      [
        { slug: "cacao-crunch", qty: 2 },
        { slug: "almond-fig", qty: 1 },
      ],
      [product("cacao-crunch", 499), product("almond-fig", 599)],
    );

    expect(priced.subtotalCents).toBe(499 * 2 + 599);
  });

  test("reports slugs missing from the catalog and excludes them from the subtotal", () => {
    const priced = priceCart(
      [
        { slug: "cacao-crunch", qty: 1 },
        { slug: "discontinued", qty: 2 },
      ],
      [product("cacao-crunch", 499)],
    );

    expect(priced.lines.map((line) => line.slug)).toEqual(["cacao-crunch"]);
    expect(priced.unavailable).toEqual([{ slug: "discontinued", qty: 2 }]);
    expect(priced.subtotalCents).toBe(499);
  });

  test("carries the first catalog image through to the line", () => {
    const priced = priceCart(
      [{ slug: "cacao-crunch", qty: 1 }],
      [product("cacao-crunch", 499, { imageUrls: ["first.png", "second.png"] })],
    );

    expect(priced.lines[0].imageUrl).toBe("first.png");
  });

  test("is empty for an empty cart", () => {
    expect(priceCart([], [product("cacao-crunch", 499)])).toEqual({
      lines: [],
      unavailable: [],
      subtotalCents: 0,
    });
  });
});

describe("freeShippingProgress", () => {
  test("reports how much more is needed below the threshold", () => {
    expect(freeShippingProgress(1000, 2500)).toEqual({
      qualified: false,
      remainingCents: 1500,
      thresholdCents: 2500,
    });
  });

  test("qualifies exactly at the threshold", () => {
    expect(freeShippingProgress(2500, 2500)).toEqual({
      qualified: true,
      remainingCents: 0,
      thresholdCents: 2500,
    });
  });

  test("qualifies above the threshold without reporting a negative remainder", () => {
    expect(freeShippingProgress(4000, 2500)).toEqual({
      qualified: true,
      remainingCents: 0,
      thresholdCents: 2500,
    });
  });

  test("returns null while the threshold is unknown, so the UI can stay quiet", () => {
    expect(freeShippingProgress(1000, undefined)).toBeNull();
  });

  test("treats a zero threshold as free shipping for everyone", () => {
    expect(freeShippingProgress(0, 0)).toEqual({
      qualified: true,
      remainingCents: 0,
      thresholdCents: 0,
    });
    expect(freeShippingProgress(1000, 0)).toEqual({
      qualified: true,
      remainingCents: 0,
      thresholdCents: 0,
    });
  });

  test("does not promise free shipping on an empty cart", () => {
    expect(freeShippingProgress(0, 2500)).toEqual({
      qualified: false,
      remainingCents: 2500,
      thresholdCents: 2500,
    });
  });
});
