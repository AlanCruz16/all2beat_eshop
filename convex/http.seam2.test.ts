import { execFileSync } from "node:child_process";
import Stripe from "stripe";
import { describe, expect, test } from "vitest";

// Seam 2 (spec "Testing Decisions"): a genuinely Stripe-signed request, POSTed
// over the network to the **deployed** webhook. This is the one test that can
// catch the raw-body gotcha — a mock accepts whatever string it is handed, so
// only a real signature over real bytes says whether `constructEventAsync` and
// `request.text()` agree. Everything the handler then *does* is Seam 1's job
// (`orders.test.ts`).
//
// Run with `npm run test:seam2`. Needs:
//   - `NEXT_PUBLIC_CONVEX_SITE_URL` in `.env.local` (the `.convex.site` origin,
//     not `.convex.cloud` — HTTP actions are served from the former)
//   - `STRIPE_WEBHOOK_SECRET` set on that Convex deployment
//     (`npx convex env set STRIPE_WEBHOOK_SECRET whsec_…`), which is where it
//     lives by design — see `.env.example`. Read back through the CLI below
//     rather than duplicated into `.env.local`.
//   - the current `convex/` pushed to that deployment (`npx convex dev`)
// Skipped, not failed, when any of those is missing.

const siteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.replace(/\/+$/, "");

// The deployment's own copy of the signing secret. Signing with anything else
// would only ever prove that a mismatched secret is rejected.
function deploymentWebhookSecret(): string | undefined {
  const fromEnv = process.env.STRIPE_WEBHOOK_SECRET;
  if (fromEnv?.startsWith("whsec_")) {
    return fromEnv;
  }
  try {
    // Prints the value, or a "not found" line — with exit code 0 either way,
    // so the prefix is what decides.
    const output = execFileSync(
      "npx",
      ["convex", "env", "get", "STRIPE_WEBHOOK_SECRET"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return output.startsWith("whsec_") ? output : undefined;
  } catch {
    return undefined;
  }
}

const secret = deploymentWebhookSecret();
const canRun = siteUrl !== undefined && secret !== undefined;

if (!canRun) {
  // Loudly, because a skipped suite reports green having asserted nothing, and
  // this is the only test in the project that exercises the real endpoint.
  console.warn(
    `SKIPPING the webhook Seam 2 tests: ${siteUrl === undefined ? "NEXT_PUBLIC_CONVEX_SITE_URL is not in .env.local" : "STRIPE_WEBHOOK_SECRET is not set on the Convex deployment"}. Signature verification is going unverified.`,
  );
}

// An event type the endpoint acknowledges without touching a table, so a run
// of these tests leaves no rows behind in the deployment they are pointed at.
// What is under test is verification, not dispatch.
const payload = JSON.stringify({
  id: "evt_seam2_signature_check",
  object: "event",
  type: "payment_intent.created",
  data: { object: { id: "pi_seam2", object: "payment_intent" } },
});

async function postWebhook(body: string, signature: string) {
  return await fetch(`${siteUrl}/stripe/webhook`, {
    method: "POST",
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    body,
  });
}

describe.skipIf(!canRun)("the deployed webhook verifies real signatures", () => {
  function sign(body: string, signingSecret = secret ?? "") {
    return Stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: signingSecret,
    });
  }

  test("accepts a correctly signed payload", async () => {
    const response = await postWebhook(payload, sign(payload));

    expect(response.status).toBe(200);
  });

  test("dispatches a signed event of a type it actually handles", async () => {
    // The other tests here use an ignored event type so a run leaves nothing
    // behind. This one goes all the way into a handler — an expiry for a
    // session that never existed, which settles nothing but does write the
    // `stripeEvents` row, hence the id that is unique per run.
    const body = JSON.stringify({
      id: `evt_seam2_${crypto.randomUUID()}`,
      object: "event",
      type: "checkout.session.expired",
      data: { object: { id: "cs_seam2_never_existed", object: "checkout.session" } },
    });

    const response = await postWebhook(body, sign(body));

    expect(response.status).toBe(200);
  });

  test("rejects a payload edited after it was signed", async () => {
    const signature = sign(payload);
    // One character of the id — the whole body is what the signature covers.
    const tampered = payload.replace("pi_seam2", "pi_seam2x");

    const response = await postWebhook(tampered, signature);

    expect(response.status).toBe(400);
  });

  test("rejects a signature made with the wrong secret", async () => {
    const response = await postWebhook(
      payload,
      sign(payload, "whsec_not_the_deployments_secret"),
    );

    expect(response.status).toBe(400);
  });

  test("rejects a request with no signature at all", async () => {
    const response = await fetch(`${siteUrl}/stripe/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });

    expect(response.status).toBe(400);
  });
});
