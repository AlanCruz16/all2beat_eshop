"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import { useCart } from "@/app/components/CartProvider";
import { CheckoutLineErrors } from "@/app/components/CheckoutLineErrors";
import type { CreateCheckoutSessionResult } from "@/lib/checkout";
import { createCheckoutSession } from "./actions";

// Loaded once for the module, not per render — `EmbeddedCheckoutProvider`
// requires a stable `stripe` prop and will not accept a changed one.
const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "",
);

export function CheckoutView() {
  const { lines, hydrated } = useCart();
  const [result, setResult] = useState<CreateCheckoutSessionResult | null>(null);
  // Creating a session reserves stock, so it must happen exactly once per
  // visit — not once per effect run. React's development double-invoke and any
  // re-render caused by the cart store would otherwise hold the shopper's own
  // inventory twice over.
  const requested = useRef(false);

  useEffect(() => {
    if (!hydrated || requested.current) {
      return;
    }
    requested.current = true;
    // The cart's whole payload: slugs and quantities, no prices (§5.1 step 1).
    createCheckoutSession(lines.map(({ slug, qty }) => ({ slug, qty }))).then(
      setResult,
      (error: unknown) => {
        console.error("createCheckoutSession failed", error);
        setResult({
          ok: false,
          message: "We couldn't start checkout just now. Please try again.",
          lineErrors: [],
        });
      },
    );
  }, [hydrated, lines]);

  if (!hydrated || result === null) {
    return <p className="text-zinc-500">Starting checkout…</p>;
  }

  if (!result.ok) {
    return (
      <CheckoutLineErrors
        message={result.message}
        errors={result.lineErrors}
      />
    );
  }

  if (!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p>Checkout is not configured on this deployment.</p>
        <Link href="/cart" className="underline">
          Back to your cart
        </Link>
      </div>
    );
  }

  // Embedded, on-site — no redirect to Stripe's domain (ADR-0003). The cart is
  // cleared on /checkout/return, once the session is confirmed complete, not
  // here: the shopper can still abandon this form.
  return (
    <EmbeddedCheckoutProvider
      stripe={stripePromise}
      options={{ clientSecret: result.clientSecret }}
    >
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  );
}
