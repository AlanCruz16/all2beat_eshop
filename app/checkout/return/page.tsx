import type { Metadata } from "next";
import { Outcome, UNCONFIRMED } from "./Outcome";
import { ReturnView } from "./ReturnView";

export const metadata: Metadata = {
  title: "Order confirmation — all2beat",
};

export default async function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  // Stripe substitutes the real id into the `{CHECKOUT_SESSION_ID}` placeholder
  // in the session's `return_url`.
  const { session_id: sessionId } = await searchParams;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-12">
      <h1 className="text-2xl font-semibold">Order confirmation</h1>
      {/* No session id means this page was reached some way other than
          Stripe's return_url; there is nothing to confirm. */}
      {sessionId === undefined ? (
        <Outcome {...UNCONFIRMED} />
      ) : (
        <ReturnView sessionId={sessionId} />
      )}
    </div>
  );
}
