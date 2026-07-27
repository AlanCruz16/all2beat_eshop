"use client";

import Link from "next/link";
import { useState } from "react";
import type { Availability } from "@/convex/products";
import { MAX_LINE_QTY } from "@/lib/cart";
import { useCart } from "./CartProvider";
import { QuantityStepper } from "./QuantityStepper";

export function AddToCart({
  slug,
  name,
  availability,
}: {
  slug: string;
  name: string;
  availability: Availability;
}) {
  const { add, hydrated } = useCart();
  const [qty, setQty] = useState(1);
  const [justAdded, setJustAdded] = useState(false);

  // Deliberately no stock check here beyond the sold-out hint: the authoritative
  // check happens inside the checkout mutation, against live stock, and returns
  // a structured error the UI can render (masterplan §5.1). Duplicating it
  // against an RSC-rendered figure would only add a second, staler answer — and
  // available stock is never shown to a guest as a raw number (CONTEXT.md).
  const soldOut = availability === "sold-out";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <QuantityStepper
          qty={qty}
          max={MAX_LINE_QTY}
          onChange={(next) => {
            setQty(next);
            setJustAdded(false);
          }}
          label={name}
        />
        <button
          type="button"
          disabled={!hydrated || soldOut}
          onClick={() => {
            add(slug, qty);
            setQty(1);
            setJustAdded(true);
          }}
          className="rounded-md bg-black px-5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {soldOut ? "Sold out" : "Add to cart"}
        </button>
      </div>

      {justAdded ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Added to your cart.{" "}
          <Link href="/cart" className="underline">
            View cart
          </Link>
        </p>
      ) : null}
    </div>
  );
}
