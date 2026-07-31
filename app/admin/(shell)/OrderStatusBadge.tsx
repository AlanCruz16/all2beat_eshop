import type { Doc } from "@/convex/_generated/dataModel";

export type OrderStatus = Doc<"orders">["status"];

// The four statuses of CONTEXT.md "Order", colored so the list scans at a
// glance: paid is the one that needs action, shipped is done, and the other two
// are the exceptions worth spotting.
const STYLES: Record<OrderStatus, string> = {
  paid: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  shipped:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  refunded: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  cancelled: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STYLES[status]}`}
    >
      {status}
    </span>
  );
}
