import type { Doc } from "@/convex/_generated/dataModel";
import { Badge, type BadgeTone } from "./Badge";

export type OrderStatus = Doc<"orders">["status"];

// The four statuses of CONTEXT.md "Order", colored so the list scans at a
// glance: paid is the one that needs action, shipped is done, and the other two
// are the exceptions worth spotting.
const TONES: Record<OrderStatus, BadgeTone> = {
  paid: "attention",
  shipped: "good",
  refunded: "neutral",
  cancelled: "neutral",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge tone={TONES[status]}>
      <span className="capitalize">{status}</span>
    </Badge>
  );
}
