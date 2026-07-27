import type { Availability } from "@/convex/products";

// The cart holds slugs and quantities only — never a price. Every figure the
// shopper sees is recomputed from the live catalog (masterplan §5.1), so a
// price edited in /admin can never be undercut by a stale localStorage value.
export type CartLine = {
  slug: string;
  qty: number;
};

// One shopper cannot order more than this of a single product. Guards the stepper,
// and stops a hand-edited localStorage value from producing an absurd cart.
export const MAX_LINE_QTY = 99;

export const CART_STORAGE_KEY = "all2beat.cart.v1";

function clampQty(qty: number): number {
  return Math.min(qty, MAX_LINE_QTY);
}

export function addLine(
  lines: CartLine[],
  slug: string,
  qty: number,
): CartLine[] {
  if (qty <= 0) {
    return lines;
  }
  const existing = lines.find((line) => line.slug === slug);
  if (existing === undefined) {
    return [...lines, { slug, qty: clampQty(qty) }];
  }
  return lines.map((line) =>
    line.slug === slug ? { ...line, qty: clampQty(line.qty + qty) } : line,
  );
}

// A quantity of zero or less means "remove" — the stepper's decrement and the
// remove button are then the same operation.
export function setLineQty(
  lines: CartLine[],
  slug: string,
  qty: number,
): CartLine[] {
  if (qty <= 0) {
    return removeLine(lines, slug);
  }
  return lines.map((line) =>
    line.slug === slug ? { ...line, qty: clampQty(qty) } : line,
  );
}

export function removeLine(lines: CartLine[], slug: string): CartLine[] {
  return lines.filter((line) => line.slug !== slug);
}

export function cartItemCount(lines: CartLine[]): number {
  return lines.reduce((total, line) => total + line.qty, 0);
}

export function serializeCart(lines: CartLine[]): string {
  return JSON.stringify(lines);
}

// Deliberately total and forgiving: the input is user-writable storage that may
// predate a schema change or have been hand-edited. Anything unrecognised is
// dropped rather than thrown, so a corrupt cart degrades to an empty one
// instead of breaking hydration on every page.
export function parseStoredCart(raw: string | null): CartLine[] {
  if (raw === null || raw === "") {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const lines: CartLine[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { slug, qty } = entry as { slug?: unknown; qty?: unknown };
    if (typeof slug !== "string" || slug === "") {
      continue;
    }
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) {
      continue;
    }
    if (lines.some((line) => line.slug === slug)) {
      continue;
    }
    lines.push({ slug, qty: clampQty(qty) });
  }
  return lines;
}

// The shape `priceCart` needs from the catalog — structurally satisfied by
// `products.listBySlugs` rows, without coupling this module to Convex.
export type CatalogProduct = {
  slug: string;
  name: string;
  priceCents: number;
  imageUrls: string[];
  availability: Availability;
};

export type PricedCartLine = {
  slug: string;
  qty: number;
  name: string;
  unitPriceCents: number;
  lineTotalCents: number;
  imageUrl: string | undefined;
  availability: Availability;
};

export type PricedCart = {
  lines: PricedCartLine[];
  // Lines whose product is gone from the catalog — deactivated or deleted
  // since it was added. Surfaced so the shopper can clear them, and never
  // counted towards the subtotal.
  unavailable: CartLine[];
  subtotalCents: number;
};

export function priceCart(
  lines: CartLine[],
  products: CatalogProduct[],
): PricedCart {
  const bySlug = new Map(products.map((product) => [product.slug, product]));
  const priced: PricedCartLine[] = [];
  const unavailable: CartLine[] = [];

  for (const line of lines) {
    const product = bySlug.get(line.slug);
    if (product === undefined) {
      unavailable.push(line);
      continue;
    }
    priced.push({
      slug: line.slug,
      qty: line.qty,
      name: product.name,
      unitPriceCents: product.priceCents,
      lineTotalCents: product.priceCents * line.qty,
      imageUrl: product.imageUrls[0],
      availability: product.availability,
    });
  }

  return {
    lines: priced,
    unavailable,
    subtotalCents: priced.reduce((total, line) => total + line.lineTotalCents, 0),
  };
}

export type FreeShippingProgress = {
  qualified: boolean;
  remainingCents: number;
  thresholdCents: number;
};

// Returns null when the threshold isn't known yet (the `settings` query is
// still loading) so callers render nothing rather than a wrong number.
export function freeShippingProgress(
  subtotalCents: number,
  thresholdCents: number | undefined,
): FreeShippingProgress | null {
  if (thresholdCents === undefined) {
    return null;
  }
  // A threshold of zero means everything ships free — a setting the Admin can
  // legitimately save (ADR-0004). Handled here so no caller has to divide by it.
  if (thresholdCents <= 0) {
    return { qualified: true, remainingCents: 0, thresholdCents: 0 };
  }
  const qualified = subtotalCents > 0 && subtotalCents >= thresholdCents;
  return {
    qualified,
    remainingCents: qualified ? 0 : Math.max(0, thresholdCents - subtotalCents),
    thresholdCents,
  };
}
