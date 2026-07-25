import Image from "next/image";
import Link from "next/link";
import type { Availability } from "@/convex/products";
import { formatPriceCents } from "@/lib/format";
import { StockBadge } from "./StockBadge";

type Product = {
  slug: string;
  name: string;
  priceCents: number;
  compareAtCents?: number;
  imageUrls: string[];
  availability: Availability;
};

export function ProductCard({ product }: { product: Product }) {
  return (
    <Link
      href={`/product/${product.slug}`}
      className="group flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 transition hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900">
        {product.imageUrls[0] ? (
          <Image
            src={product.imageUrls[0]}
            alt={product.name}
            fill
            sizes="(min-width: 768px) 25vw, 50vw"
            className="object-cover transition group-hover:scale-105"
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">{product.name}</h2>
        <div className="flex items-center gap-2 text-sm">
          <span>{formatPriceCents(product.priceCents)}</span>
          {product.compareAtCents ? (
            <span className="text-zinc-400 line-through">
              {formatPriceCents(product.compareAtCents)}
            </span>
          ) : null}
        </div>
        <StockBadge availability={product.availability} />
      </div>
    </Link>
  );
}
