import { OrderDetail } from "./OrderDetail";

// The id is passed through as a plain string: `orders.get` normalizes it and
// returns null for anything that isn't a real order, so a hand-typed URL lands
// on "No such order" instead of an error screen.
export default async function AdminOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return <OrderDetail orderId={orderId} />;
}
