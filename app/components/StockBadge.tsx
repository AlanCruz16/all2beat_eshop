import type { Availability } from "@/convex/products";

const LABEL: Record<Availability, string> = {
  "in-stock": "In stock",
  "low-stock": "Only a few left",
  "sold-out": "Sold out",
};

const STYLE: Record<Availability, string> = {
  "in-stock":
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  "low-stock":
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  "sold-out": "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function StockBadge({ availability }: { availability: Availability }) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${STYLE[availability]}`}
    >
      {LABEL[availability]}
    </span>
  );
}
