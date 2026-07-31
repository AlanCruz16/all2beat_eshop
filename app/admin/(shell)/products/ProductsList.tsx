"use client";

import Image from "next/image";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { formatPriceCents } from "@/lib/format";
import { SubmitFeedback, useSubmit } from "../adminForm";
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

// Stock as the owner needs to read it: what is actually sellable, and — only
// when they differ — how many units a checkout in flight is holding back.
function StockCell({ product }: { product: ProductRow }) {
  const held = product.stock - product.available;
  return (
    <div className="space-y-1">
      <span
        className={`tabular-nums ${
          product.available === 0
            ? "font-medium text-red-700 dark:text-red-400"
            : product.lowStock
              ? "font-medium text-amber-700 dark:text-amber-400"
              : ""
        }`}
      >
        {product.available === 0
          ? "Out of stock"
          : `${product.available} available`}
      </span>
      {held > 0 && (
        <span className="block text-xs text-zinc-500">
          {held} held by checkouts in flight
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
          No products yet. Seed the catalog with <code>npm run seed</code>.
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
                <span
                  className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${
                    product.active
                      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                      : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  {product.active ? "Active" : "Inactive"}
                </span>
                <SyncStatusBadge status={product.syncStatus} />
              </div>

              <ActiveToggle product={product} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
