import { defineConfig } from "vitest/config";
import { defaultExclude } from "vitest/config";

// Seam 1 (spec "Testing Decisions"): everything fast, in-process, and
// mock-backed. Seam 2's real-Stripe tests are excluded here and run from
// `vitest.seam2.config.ts` — they need network and a Stripe key, so they must
// not be able to break `npm test` for someone who has neither.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    exclude: [...defaultExclude, "**/*.seam2.test.ts"],
  },
});
