"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MAX_LINE_QTY, freeShippingProgress, priceCart } from "@/lib/cart";
import { formatPriceCents } from "@/lib/format";
import { useCart } from "./CartProvider";
import { FreeShippingProgress } from "./FreeShippingProgress";
import { QuantityStepper } from "./QuantityStepper";
import { StockBadge } from "./StockBadge";

function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Remove ${label} from your cart`}
      className="text-sm text-zinc-500 underline hover:text-black dark:hover:text-white"
    >
      Remove
    </button>
  );
}

export function CartView() {
  const { lines, hydrated, setQty, remove } = useCart();

  const slugs = useMemo(() => lines.map((line) => line.slug), [lines]);
  // Prices are read live from Convex on every render of the cart, never taken
  // from what was stored when the item was added (spec user story 15).
  const products = useQuery(
    api.products.listBySlugs,
    hydrated ? { slugs } : "skip",
  );
  const settings = useQuery(api.settings.get, {});

  if (!hydrated || products === undefined) {
    return <p className="text-zinc-500">Loading your cart…</p>;
  }

  const { lines: pricedLines, unavailable, subtotalCents } = priceCart(
    lines,
    products,
  );
  const progress = freeShippingProgress(
    subtotalCents,
    settings?.freeShippingThresholdCents,
  );

  if (pricedLines.length === 0 && unavailable.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-zinc-600 dark:text-zinc-400">Your cart is empty.</p>
        <Link href="/shop" className="underline">
          Browse the shop
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-10 md:grid-cols-[2fr_1fr]">
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {pricedLines.map((line) => (
          <li key={line.slug} className="flex gap-4 py-4">
            <Link
              href={`/product/${line.slug}`}
              className="relative aspect-square w-20 shrink-0 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900"
            >
              {line.imageUrl ? (
                <Image
                  src={line.imageUrl}
                  alt={line.name}
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              ) : null}
            </Link>

            <div className="flex flex-1 flex-col gap-2">
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <Link href={`/product/${line.slug}`} className="font-medium">
                    {line.name}
                  </Link>
                  <span className="text-sm text-zinc-500">
                    {formatPriceCents(line.unitPriceCents)} each
                  </span>
                </div>
                <span className="tabular-nums">
                  {formatPriceCents(line.lineTotalCents)}
                </span>
              </div>

              {/* Wrapped so the badge keeps its intrinsic width instead of
                  stretching to the flex column. */}
              <div className="self-start">
                <StockBadge availability={line.availability} />
              </div>

              <div className="flex items-center gap-4">
                <QuantityStepper
                  qty={line.qty}
                  max={MAX_LINE_QTY}
                  onChange={(qty) => setQty(line.slug, qty)}
                  label={line.name}
                />
                <RemoveButton
                  label={line.name}
                  onClick={() => remove(line.slug)}
                />
              </div>
            </div>
          </li>
        ))}

        {/* The product is gone from the catalog, so its name is gone with it —
            the slug is the only thing left to identify it by. */}
        {unavailable.map((line) => (
          <li
            key={line.slug}
            className="flex items-center justify-between gap-4 py-4"
          >
            <span className="text-sm text-zinc-500">
              <span className="font-medium">{line.slug}</span> is no longer
              available and has not been counted in your total.
            </span>
            <RemoveButton
              label={line.slug}
              onClick={() => remove(line.slug)}
            />
          </li>
        ))}
      </ul>

      <div className="flex h-fit flex-col gap-4 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <span className="font-medium">Subtotal</span>
          <span className="tabular-nums">
            {formatPriceCents(subtotalCents)}
          </span>
        </div>
        <p className="text-sm text-zinc-500">
          Shipping and any tax are calculated at checkout.
        </p>
        {progress ? <FreeShippingProgress progress={progress} /> : null}
        <button
          type="button"
          disabled
          className="rounded-md bg-black px-5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
        >
          Checkout
        </button>
        <p className="text-sm text-zinc-500">Checkout is not available yet.</p>
      </div>
    </div>
  );
}
