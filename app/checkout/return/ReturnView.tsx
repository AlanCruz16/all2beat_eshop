"use client";

import { useEffect, useRef, useState } from "react";
import { useCart } from "@/app/components/CartProvider";
import { retrieveSession, type RetrievedSession } from "../actions";
import { Outcome, UNCONFIRMED } from "./Outcome";

type State =
  | { phase: "loading" }
  | { phase: "loaded"; session: RetrievedSession | null };

export function ReturnView({ sessionId }: { sessionId: string }) {
  const { clear } = useCart();
  const [state, setState] = useState<State>({ phase: "loading" });
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) {
      return;
    }
    requested.current = true;
    // Landing here is not proof of payment — the session is retrieved and its
    // status checked before anything is called a success (ADR-0003).
    retrieveSession(sessionId).then(
      (session) => setState({ phase: "loaded", session }),
      (error: unknown) => {
        console.error("retrieveSession failed", error);
        setState({ phase: "loaded", session: null });
      },
    );
  }, [sessionId]);

  const complete =
    state.phase === "loaded" && state.session?.status === "complete";

  useEffect(() => {
    // Only a confirmed-complete session empties the cart. An abandoned or
    // expired one leaves it exactly as it was, so the shopper can try again.
    if (complete) {
      clear();
    }
  }, [complete, clear]);

  if (state.phase === "loading") {
    return <p className="text-zinc-500">Confirming your order…</p>;
  }

  const session = state.session;

  if (session === null) {
    return <Outcome {...UNCONFIRMED} />;
  }

  if (session.status === "complete") {
    return (
      <Outcome
        heading="Thank you — your order is confirmed"
        body={
          session.customerEmail === null
            ? "A receipt is on its way to you by email."
            : `A receipt is on its way to ${session.customerEmail}.`
        }
      />
    );
  }

  if (session.status === "expired") {
    return (
      <Outcome
        heading="This checkout expired"
        body="Your items were released back into stock. Your cart is still here — start again whenever you're ready."
      />
    );
  }

  // `open` — the shopper came back without finishing.
  return (
    <Outcome
      heading="Your order isn't finished"
      body="No payment was taken. Your cart is untouched, so you can pick up where you left off."
    />
  );
}
