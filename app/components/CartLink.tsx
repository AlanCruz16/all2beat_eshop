"use client";

import Link from "next/link";
import { useCart } from "./CartProvider";

export function CartLink() {
  const { itemCount, hydrated } = useCart();

  return (
    <Link
      href="/cart"
      className="text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white"
    >
      Cart
      {/* Rendered only after hydration — the server has no way to know what is
          in this shopper's localStorage. */}
      {hydrated && itemCount > 0 ? (
        <span className="ml-1 rounded-full bg-black px-2 py-0.5 text-xs text-white tabular-nums dark:bg-white dark:text-black">
          {itemCount}
        </span>
      ) : null}
    </Link>
  );
}
