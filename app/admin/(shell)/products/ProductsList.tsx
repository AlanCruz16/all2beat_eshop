"use client";

import Image from "next/image";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { formatPriceCents } from "@/lib/format";
import { MAX_PRODUCTS_LISTED } from "@/lib/products";
import { SubmitFeedback, useSubmit } from "../adminForm";
import { Badge } from "../Badge";
import { SyncStatusBadge } from "./SyncStatusBadge";

type ProductRow = FunctionReturnType<typeof api.products.listForAdmin>[number];

// The one thing on this screen that is an emergency: a product whose Stripe
// mirror failed cannot be sold, and nothing on the storefront says so — the
// shopper just gets a checkout that refuses. So it is stated at the top of the
// screen, before the list, rather than left to be noticed as a badge in a row.
function UnsellableWarning({ products }: { products: ProductRow[] }) {
  if (products.length === 0) {
    return null;
  }
  return (
    <div
      role="alert"
      className="space-y-2 rounded border border-red-300 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/40"
    >
      <p className="font-medium text-red-800 dark:text-red-300">
        {products.length === 1
          ? "1 product failed to sync to Stripe and can't be sold."
          : `${products.length} products failed to sync to Stripe and can't be sold.`}
      </p>
      <ul className="space-y-1 text-red-800 dark:text-red-300">
        {products.map((product) => (
          <li key={product._id}>
            <Link href={`/admin/products/${product._id}`} className="underline">
              {product.name}
            </Link>
            {product.syncError !== undefined && ` — ${product.syncError}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Stock as the owner needs to read it: what is on the shelf, what of that is
// still sellable, and — only when they differ — how much a checkout in flight
// is holding back. The highlight rides `availability`, the same judgement the
// storefront's own badge makes about the same product.
const AVAILABILITY_CLASS: Record<ProductRow["availability"], string> = {
  "sold-out": "font-medium text-red-700 dark:text-red-400",
  "low-stock": "font-medium text-amber-700 dark:text-amber-400",
  "in-stock": "",
};

function StockCell({ product }: { product: ProductRow }) {
  return (
    <div className="space-y-1">
      <span className="block tabular-nums">{product.stock} in stock</span>
      <span
        className={`block text-xs tabular-nums ${AVAILABILITY_CLASS[product.availability]}`}
      >
        {product.availability === "sold-out"
          ? "None available to sell"
          : `${product.available} available${
              product.availability === "low-stock" ? " — running low" : ""
            }`}
      </span>
      {product.reserved > 0 && (
        <span className="block text-xs text-zinc-500">
          {product.reserved} held by checkouts in flight
        </span>
      )}
    </div>
  );
}

function ActiveToggle({ product }: { product: ProductRow }) {
  const setActive = useMutation(api.products.setActive);
  const { state, submit } = useSubmit(() =>
    setActive({ productId: product._id, active: !product.active }),
  );

  return (
    <div className="space-y-1">
      <button
        type="button"
        // Deactivating removes the product from the storefront without deleting
        // it (spec story 37) — the label says which way the click goes, and the
        // badge beside it says where it stands now.
        onClick={() => void submit()}
        disabled={state.status === "saving"}
        className="rounded border border-zinc-300 px-3 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
      >
        {product.active ? "Deactivate" : "Activate"}
      </button>
      {/* No "Saved." — the badge beside this button is the confirmation. */}
      <SubmitFeedback state={state} />
    </div>
  );
}

export function ProductsList() {
  const products = useQuery(api.products.listForAdmin, {});

  if (products === undefined) {
    return <p className="text-sm text-zinc-500">Loading products…</p>;
  }

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-medium">Products</h2>

      <UnsellableWarning
        products={products.filter((product) => product.syncStatus === "error")}
      />

      {products.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No products yet — the catalog is seeded from the deployment for now,
          so ask your developer to add the first ones.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {products.map((product) => (
            <li
              key={product._id}
              className="grid grid-cols-[auto_1fr] items-start gap-4 py-4 sm:grid-cols-[auto_2fr_1fr_1fr_auto]"
            >
              <div className="relative size-14 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-900">
                {product.imageUrl !== null && (
                  <Image
                    src={product.imageUrl}
                    alt=""
                    fill
                    sizes="56px"
                    className="object-cover"
                  />
                )}
              </div>

              <div className="space-y-1">
                <Link
                  href={`/admin/products/${product._id}`}
                  className="font-medium underline"
                >
                  {product.name}
                </Link>
                <p className="text-xs text-zinc-500">/product/{product.slug}</p>
                <p className="text-sm tabular-nums">
                  {formatPriceCents(product.priceCents)}
                  {product.compareAtCents !== undefined && (
                    <span className="text-zinc-400 line-through">
                      {" "}
                      {formatPriceCents(product.compareAtCents)}
                    </span>
                  )}
                </p>
              </div>

              <div className="text-sm">
                <StockCell product={product} />
              </div>

              <div className="flex flex-wrap items-start gap-2">
                <Badge tone={product.active ? "good" : "neutral"}>
                  {product.active ? "Active" : "Inactive"}
                </Badge>
                <SyncStatusBadge status={product.syncStatus} />
              </div>

              <ActiveToggle product={product} />
            </li>
          ))}
        </ul>
      )}

      {/* The read is bounded; a screen that quietly showed only part of the
          catalog would read as "that's all of it". */}
      {products.length === MAX_PRODUCTS_LISTED && (
        <p className="text-sm text-zinc-500">
          Showing the first {MAX_PRODUCTS_LISTED} products.
        </p>
      )}
    </section>
  );
}
