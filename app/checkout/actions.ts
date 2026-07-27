"use server";

import { headers } from "next/headers";
import Stripe from "stripe";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import {
  buildSessionParams,
  parseCheckoutItems,
  type CreateCheckoutSessionResult,
} from "@/lib/checkout";

// Checkout orchestration (masterplan §5.1). The client sends slugs and
// quantities and nothing else; every figure that ends up on the Stripe session
// is read server-side from Convex in this request.

function stripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set on this deployment");
  }
  return new Stripe(secretKey);
}

// Stripe needs an absolute `return_url`, and this app runs on localhost, on
// per-branch preview URLs, and in production. Derived from the request by
// default so none of those need configuring; `NEXT_PUBLIC_SITE_URL` overrides
// it for a deployment fronted by a domain the request headers don't reveal.
async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (host === null) {
    throw new Error("Cannot determine the site origin for Stripe's return_url");
  }
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function createCheckoutSession(
  items: unknown,
): Promise<CreateCheckoutSessionResult> {
  const parsed = parseCheckoutItems(items);
  if (parsed === null) {
    return {
      ok: false,
      message: "That cart couldn't be read. Please refresh and try again.",
      lineErrors: [],
    };
  }
  if (parsed.length === 0) {
    return { ok: false, message: "Your cart is empty.", lineErrors: [] };
  }

  // Stock is checked and held in one transaction before Stripe hears anything —
  // "reserve first, release on Stripe failure" (masterplan §5.1). Rolling back
  // a reservation is cheaper than orphaning a session someone could still pay.
  const reserved = await fetchMutation(api.checkout.reserveCart, {
    items: parsed,
  });
  if (!reserved.ok) {
    return {
      ok: false,
      message: "Some items in your cart are no longer available.",
      lineErrors: reserved.errors,
    };
  }

  const { quote } = reserved;
  let session: Stripe.Checkout.Session;
  try {
    session = await stripeClient().checkout.sessions.create(
      buildSessionParams(quote, await siteOrigin()),
    );
  } catch (error) {
    // The rollback. Without it the shopper's own stock stays locked away from
    // them for the full TTL after a transient Stripe failure.
    await fetchMutation(api.checkout.releaseReservation, {
      reservationId: quote.reservationId,
    });
    console.error("Stripe checkout session creation failed", error);
    return {
      ok: false,
      message: "We couldn't start checkout just now. Please try again.",
      lineErrors: [],
    };
  }

  if (session.client_secret === null) {
    await fetchMutation(api.checkout.releaseReservation, {
      reservationId: quote.reservationId,
    });
    return {
      ok: false,
      message: "We couldn't start checkout just now. Please try again.",
      lineErrors: [],
    };
  }

  await fetchMutation(api.checkout.attachSession, {
    reservationId: quote.reservationId,
    stripeSessionId: session.id,
  });

  // Embedded mode's contract: the client secret, not a URL to redirect to
  // (ADR-0003).
  return { ok: true, clientSecret: session.client_secret };
}

export type RetrievedSession = {
  status: Stripe.Checkout.Session.Status | null;
  paymentStatus: Stripe.Checkout.Session.PaymentStatus | null;
  customerEmail: string | null;
};

// What the return page confirms the outcome against, rather than trusting the
// fact that Stripe redirected there. It runs from the client component so the
// page can react to the answer, but the retrieve itself has to happen here —
// Stripe.js has no session-retrieval API, and the secret key never reaches a
// browser. Returns only the three fields the page renders.
export async function retrieveSession(
  sessionId: unknown,
): Promise<RetrievedSession | null> {
  if (typeof sessionId !== "string" || !sessionId.startsWith("cs_")) {
    return null;
  }
  try {
    const session = await stripeClient().checkout.sessions.retrieve(sessionId);
    return {
      status: session.status,
      paymentStatus: session.payment_status,
      customerEmail: session.customer_details?.email ?? null,
    };
  } catch (error) {
    console.error("Stripe checkout session retrieval failed", error);
    return null;
  }
}
