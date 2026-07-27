import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Seam 2 (spec "Testing Decisions"): the small set of tests that talk to
// Stripe's real test-mode API instead of a mock, to catch the one thing a mock
// cannot — whether our actual parameter shapes are valid Stripe calls.
//
// Deliberately a separate config, and not part of `npm test`: these are slow,
// need network, and need a Stripe test-mode key. Run them with
// `npm run test:seam2`.
export default defineConfig(({ mode }) => ({
  test: {
    // Node, not edge-runtime: the Stripe SDK's default HTTP client is Node's.
    environment: "node",
    include: ["**/*.seam2.test.ts"],
    // Slower than a unit test by two orders of magnitude — it's a round trip
    // to Stripe.
    testTimeout: 30_000,
    // Reads `.env.local`, so the key that already runs the app locally is the
    // one these use. No extra dependency: this is Vite's own loader.
    env: loadEnv(mode, process.cwd(), ""),
  },
}));
