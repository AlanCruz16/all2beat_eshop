import type { Metadata } from "next";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { ProductCard } from "@/app/components/ProductCard";

export const metadata: Metadata = {
  title: "Shop — all2beat",
};

export default async function ShopPage() {
  const products = await fetchQuery(api.products.listActive);

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="mb-8 text-2xl font-semibold">Shop</h1>
      {products.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400">
          No products are available right now — check back soon.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
          {products.map((product) => (
            <ProductCard key={product._id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
