import Link from "next/link";
import type { CheckoutLineError } from "@/lib/checkout";

// The wording for a checkout the server refused. `reserveCart` returns the
// reason and the number; the sentence is this component's business.
//
// This is the one place a raw available-stock count reaches a shopper, and
// deliberately so: masterplan §5.1 step 3 asks for exactly "Only 3 left of X".
// CONTEXT.md's rule that stock is never surfaced as a number governs browsing,
// where the figure is idle curiosity — here the shopper is blocked and the
// number is the only thing that tells them how to get unblocked.
function describe(error: CheckoutLineError): string {
  // An unknown slug has no name left to call it by — the product is gone.
  const label = error.name ?? error.slug;
  switch (error.reason) {
    case "unavailable":
      return `${label} is no longer available.`;
    case "unsellable":
      return `${label} can't be purchased right now. Please try again later.`;
    case "insufficient-stock":
      return error.availableQty === 0
        ? `${label} just sold out.`
        : `Only ${error.availableQty} left of ${label} — reduce the quantity to continue.`;
  }
}

export function CheckoutLineErrors({
  message,
  errors,
}: {
  message: string;
  errors: CheckoutLineError[];
}) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-lg border border-amber-300 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/40">
      <p className="font-medium">{message}</p>
      {errors.length > 0 ? (
        <ul className="list-disc pl-5 text-sm">
          {errors.map((error) => (
            <li key={error.slug}>{describe(error)}</li>
          ))}
        </ul>
      ) : null}
      <Link href="/cart" className="text-sm underline">
        Back to your cart
      </Link>
    </div>
  );
}
