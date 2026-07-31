"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatPriceCents, formatTimestamp } from "@/lib/format";
import { OrderStatusBadge } from "../../OrderStatusBadge";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

// The two write forms below share one shape: a field, a submit that reports
// what it's doing, and any failure said out loud rather than swallowed. The
// mutations throw on an unauthorized caller (`requireAdmin`), and that is worth
// showing — a silently-ignored click looks like the order simply didn't save.
function useSubmit(run: () => Promise<unknown>) {
  const [state, setState] = useState<
    { status: "idle" | "saving" | "saved" } | { status: "error"; message: string }
  >({ status: "idle" });

  async function submit() {
    setState({ status: "saving" });
    try {
      await run();
      setState({ status: "saved" });
    } catch (error) {
      console.error(error);
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Something went wrong",
      });
    }
  }

  return { state, submit };
}

function SubmitFeedback({
  state,
  savedLabel,
}: {
  state: ReturnType<typeof useSubmit>["state"];
  savedLabel: string;
}) {
  if (state.status === "error") {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {state.message}
      </p>
    );
  }
  if (state.status === "saved") {
    return <p className="text-sm text-zinc-500">{savedLabel}</p>;
  }
  return null;
}

function ShipForm({
  orderId,
  status,
  trackingNumber,
  shippedAt,
}: {
  orderId: string;
  status: "paid" | "shipped" | "refunded" | "cancelled";
  trackingNumber: string | undefined;
  shippedAt: number | undefined;
}) {
  const markShipped = useMutation(api.orders.markShipped);
  const [tracking, setTracking] = useState(trackingNumber ?? "");
  const { state, submit } = useSubmit(() =>
    markShipped({ orderId, trackingNumber: tracking }),
  );

  // Shipping over a refund or a cancellation would erase the only record this
  // store keeps of it, so the server refuses; the form says so rather than
  // offering a button that always fails.
  if (status === "refunded" || status === "cancelled") {
    return (
      <p className="text-sm text-zinc-500">
        This order is {status} — fulfillment can no longer be recorded against
        it.
      </p>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {shippedAt !== undefined && (
        <p className="text-sm text-zinc-500">
          Shipped {formatTimestamp(shippedAt)}
        </p>
      )}
      <label className="block space-y-1 text-sm">
        <span className="text-zinc-500">Tracking number (optional)</span>
        <input
          type="text"
          value={tracking}
          onChange={(event) => setTracking(event.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={state.status === "saving"}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {status === "shipped" ? "Update shipping" : "Mark shipped"}
        </button>
        <SubmitFeedback state={state} savedLabel="Saved." />
      </div>
    </form>
  );
}

function NoteForm({ orderId, notes }: { orderId: string; notes: string | undefined }) {
  const saveNote = useMutation(api.orders.saveNote);
  const [note, setNote] = useState(notes ?? "");
  const { state, submit } = useSubmit(() => saveNote({ orderId, note }));

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="block space-y-1 text-sm">
        <span className="text-zinc-500">
          Internal note — never shown to the customer
        </span>
        <textarea
          value={note}
          rows={4}
          onChange={(event) => setNote(event.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={state.status === "saving"}
          className="rounded border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50 dark:border-zinc-700"
        >
          Save note
        </button>
        <SubmitFeedback state={state} savedLabel="Note saved." />
      </div>
    </form>
  );
}

export function OrderDetail({ orderId }: { orderId: string }) {
  const order = useQuery(api.orders.get, { orderId });

  if (order === undefined) {
    return <p className="text-sm text-zinc-500">Loading order…</p>;
  }

  if (order === null) {
    return (
      <section className="space-y-4">
        <p className="text-sm text-zinc-500">No such order.</p>
        <Link href="/admin" className="text-sm underline">
          Back to orders
        </Link>
      </section>
    );
  }

  const address = order.shippingAddress;

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <Link href="/admin" className="text-sm text-zinc-500 underline">
          ← Orders
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-medium">{order.email}</h2>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className="text-sm text-zinc-500">
          Paid {formatTimestamp(order.paidAt)}
        </p>
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Items</h3>
          {/* The snapshot as it was at time of sale — never re-priced from the
              live product (CONTEXT.md "Order"). */}
          <ul className="space-y-2">
            {order.items.map((item, index) => (
              <li
                key={`${item.productId}-${index}`}
                className="flex justify-between gap-4 text-sm"
              >
                <span>
                  {item.qty} × {item.name}
                  <span className="text-zinc-500">
                    {" "}
                    @ {formatPriceCents(item.unitPriceCents)}
                  </span>
                </span>
                <span className="tabular-nums">
                  {formatPriceCents(item.unitPriceCents * item.qty)}
                </span>
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <Row label="Subtotal" value={formatPriceCents(order.subtotalCents)} />
            <Row label="Shipping" value={formatPriceCents(order.shippingCents)} />
            <Row label="Tax" value={formatPriceCents(order.taxCents)} />
            <div className="flex justify-between gap-4 text-sm font-medium">
              <span>Total</span>
              <span className="tabular-nums">
                {formatPriceCents(order.totalCents)}
              </span>
            </div>
          </div>
          {order.stripePaymentUrl === null ? (
            <p className="text-sm text-zinc-500">
              No Stripe payment recorded for this order.
            </p>
          ) : (
            <a
              href={order.stripePaymentUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm underline"
            >
              View payment in Stripe ↗
            </a>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium">Ship to</h3>
          <address className="text-sm not-italic text-zinc-600 dark:text-zinc-400">
            {address.name}
            <br />
            {address.line1}
            <br />
            {address.line2 !== undefined && address.line2 !== "" && (
              <>
                {address.line2}
                <br />
              </>
            )}
            {address.city}, {address.state} {address.postalCode}
            <br />
            {address.country}
          </address>
        </div>
      </div>

      <div className="grid gap-8 border-t border-zinc-200 pt-8 sm:grid-cols-2 dark:border-zinc-800">
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Fulfillment</h3>
          <ShipForm
            orderId={order._id}
            status={order.status}
            trackingNumber={order.trackingNumber}
            shippedAt={order.shippedAt}
          />
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Notes</h3>
          <NoteForm orderId={order._id} notes={order.notes} />
        </div>
      </div>
    </section>
  );
}
