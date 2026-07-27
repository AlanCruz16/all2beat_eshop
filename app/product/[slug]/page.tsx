import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { formatPriceCents } from "@/lib/format";
import { StockBadge } from "@/app/components/StockBadge";
import { AddToCart } from "@/app/components/AddToCart";

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchQuery(api.products.getBySlug, { slug });
  if (product === null) {
    return { title: "Product not found — all2beat" };
  }
  return { title: `${product.name} — all2beat` };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const product = await fetchQuery(api.products.getBySlug, { slug });

  if (product === null) {
    notFound();
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-6 py-12 md:grid-cols-2">
      <div className="grid gap-4">
        <div className="relative aspect-square w-full overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900">
          {product.imageUrls[0] ? (
            <Image
              src={product.imageUrls[0]}
              alt={product.name}
              fill
              sizes="(min-width: 768px) 50vw, 100vw"
              className="object-cover"
              preload
            />
          ) : null}
        </div>
        {product.imageUrls.length > 1 ? (
          <div className="grid grid-cols-4 gap-2">
            {product.imageUrls.slice(1).map((url) => (
              <div
                key={url}
                className="relative aspect-square overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900"
              >
                <Image
                  src={url}
                  alt={product.name}
                  fill
                  sizes="12vw"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{product.name}</h1>
        <div className="flex items-center gap-3">
          <span className="text-lg">
            {formatPriceCents(product.priceCents)}
          </span>
          {product.compareAtCents ? (
            <span className="text-zinc-400 line-through">
              {formatPriceCents(product.compareAtCents)}
            </span>
          ) : null}
        </div>
        <StockBadge availability={product.availability} />
        <p className="whitespace-pre-line text-zinc-600 dark:text-zinc-400">
          {product.description}
        </p>
        <AddToCart
          slug={product.slug}
          name={product.name}
          availability={product.availability}
        />
      </div>
    </div>
  );
}
