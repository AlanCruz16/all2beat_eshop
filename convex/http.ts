import { httpRouter } from "convex/server";
import Stripe from "stripe";
import { env, httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// Stripe's webhook, pointed straight at Convex rather than at a Next.js route
// (masterplan §5.2): order creation and stock movement are database concerns,
// and routing them through Vercel adds a hop, a cold start, and raw-body
// friction for nothing.
//
// Deployment: register `https://<deployment>.convex.site/stripe/webhook` in the
// Stripe Dashboard and put its signing secret in the Convex deployment's
// `STRIPE_WEBHOOK_SECRET` (`npx convex env set`) — a Convex env var, not a
// Vercel one; nothing in `.env.local` reaches this file. Test-mode and
// live-mode endpoints have different secrets (masterplan §11.7).
//
// **The gotcha** (masterplan §5.2): the Convex runtime is not Node.
// `constructEvent` needs Node's synchronous crypto and will fail here — only
// the async, SubtleCrypto-backed `constructEventAsync` works, and it is handed
// the provider explicitly rather than left to pick a default per bundle target.
const cryptoProvider = Stripe.createSubtleCryptoProvider();

// Stripe's default tolerance (5 minutes) between the signature's timestamp and
// now. Stated rather than passed as `undefined` because the argument in front
// of the crypto provider is positional.
const SIGNATURE_TOLERANCE_SECONDS = 300;

// Stripe expands nothing in a webhook payload, so an id-or-object field arrives
// as the id — but the type says either.
function idOf(field: string | { id: string } | null): string | undefined {
  if (field === null) {
    return undefined;
  }
  return typeof field === "string" ? field : field.id;
}

// The address Stripe collected, flattened into the order's own shape. Every
// part is optional in Stripe's type and required in ours: `/admin` needs
// *something* to ship to, and a blank line is more useful there than a dropped
// order.
function shippingAddressOf(session: Stripe.Checkout.Session) {
  const details = session.collected_information?.shipping_details ?? null;
  const address = details?.address;
  return {
    name: details?.name ?? "",
    line1: address?.line1 ?? "",
    ...(address?.line2 ? { line2: address.line2 } : {}),
    city: address?.city ?? "",
    state: address?.state ?? "",
    postalCode: address?.postal_code ?? "",
    country: address?.country ?? "",
  };
}

const handleStripeWebhook = httpAction(async (ctx, request) => {
  const signature = request.headers.get("stripe-signature");
  if (signature === null) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // Ours to fix, not Stripe's — a 500 is the honest answer and gets the
    // delivery retried once the secret is set.
    console.error("STRIPE_WEBHOOK_SECRET is not set on this Convex deployment");
    return new Response("Webhook is not configured", { status: 500 });
  }

  // The raw text, never a parsed-and-restringified body: the signature covers
  // these exact bytes. `webhook.seam2.test.ts` proves that end to end.
  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = await Stripe.webhooks.constructEventAsync(
      payload,
      signature,
      secret,
      SIGNATURE_TOLERANCE_SECONDS,
      cryptoProvider,
    );
  } catch (error) {
    // Unsigned or tampered with. Retrying won't help, so say 400 and stop.
    console.error("Stripe webhook signature verification failed", error);
    return new Response("Invalid signature", { status: 400 });
  }

  // Each branch hands plain fields to one mutation, which applies the whole
  // event — idempotency guard included — in a single transaction (`orders.ts`).
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      await ctx.runMutation(internal.orders.recordCheckoutCompleted, {
        eventId: event.id,
        sessionId: session.id,
        paymentIntentId: idOf(session.payment_intent),
        email: session.customer_details?.email ?? "",
        subtotalCents: session.amount_subtotal ?? 0,
        shippingCents: session.total_details?.amount_shipping ?? 0,
        taxCents: session.total_details?.amount_tax ?? 0,
        totalCents: session.amount_total ?? 0,
        shippingAddress: shippingAddressOf(session),
      });
      break;
    }
    case "checkout.session.expired": {
      await ctx.runMutation(internal.orders.recordCheckoutExpired, {
        eventId: event.id,
        sessionId: event.data.object.id,
      });
      break;
    }
    case "charge.refunded": {
      const paymentIntentId = idOf(event.data.object.payment_intent);
      if (paymentIntentId !== undefined) {
        await ctx.runMutation(internal.orders.recordChargeRefunded, {
          eventId: event.id,
          paymentIntentId,
        });
      }
      break;
    }
    // Everything else Stripe is configured to send: acknowledged and dropped,
    // deliberately without a `stripeEvents` row — nothing was applied, so
    // there is nothing to guard against re-applying.
    default:
      break;
  }

  // 200 for anything we understood. Non-2xx puts the delivery back in Stripe's
  // retry queue, which is only ever right for the two failures above.
  return new Response(null, { status: 200 });
});

const http = httpRouter();

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: handleStripeWebhook,
});

export default http;
