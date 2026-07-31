"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MAX_ORDERS_LISTED } from "@/lib/orders";
import { formatPriceCents, formatTimestamp } from "@/lib/format";
import { OrderStatusBadge, type OrderStatus } from "./OrderStatusBadge";

// "All" is a UI-only option, not a status — the query simply omits the filter.
const FILTERS: Array<{ value: OrderStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "shipped", label: "Shipped" },
  { value: "refunded", label: "Refunded" },
  { value: "cancelled", label: "Cancelled" },
];

// "2 × Cacao Crunch, 1 × Almond Fig" — enough to recognise an order without
// opening it.
function itemSummary(items: Array<{ name: string; qty: number }>): string {
  return items.map((item) => `${item.qty} × ${item.name}`).join(", ");
}

export function OrdersList() {
  const [filter, setFilter] = useState<OrderStatus | "all">("all");
  const orders = useQuery(
    api.orders.list,
    filter === "all" ? {} : { status: filter },
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="text-lg font-medium">Orders</h2>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(({ value, label }) => {
            const isCurrent = value === filter;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={isCurrent}
                onClick={() => setFilter(value)}
                className={`rounded-full border px-3 py-1 text-sm ${
                  isCurrent
                    ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-zinc-300 text-zinc-600 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {orders === undefined ? (
        <p className="text-sm text-zinc-500">Loading orders…</p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {filter === "all"
            ? "No orders yet."
            : `No ${filter} orders right now.`}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {orders.map((order) => (
            <li key={order._id}>
              <Link
                href={`/admin/orders/${order._id}`}
                className="flex flex-col gap-1 py-4 hover:bg-zinc-50 sm:flex-row sm:items-center sm:gap-4 dark:hover:bg-zinc-900"
              >
                <span className="w-44 shrink-0 text-sm text-zinc-500">
                  {formatTimestamp(order.paidAt)}
                </span>
                <span className="w-56 shrink-0 truncate text-sm">
                  {order.email}
                </span>
                <span className="flex-1 truncate text-sm text-zinc-500">
                  {itemSummary(order.items)}
                </span>
                <span className="w-20 shrink-0 text-sm tabular-nums sm:text-right">
                  {formatPriceCents(order.totalCents)}
                </span>
                <span className="w-24 shrink-0 sm:text-right">
                  <OrderStatusBadge status={order.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* A truncated list must say so — otherwise "my oldest order is gone"
          looks like data loss rather than a cap. */}
      {orders !== undefined && orders.length === MAX_ORDERS_LISTED && (
        <p className="text-sm text-zinc-500">
          Showing the {MAX_ORDERS_LISTED} most recent orders.
        </p>
      )}
    </section>
  );
}
