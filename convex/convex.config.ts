import { defineApp } from "convex/server";
import { v } from "convex/values";

// Convex-side environment variables, read through the typed `env` object from
// `_generated/server` rather than `process.env`. These are set per deployment
// (`npx convex env set KEY value [--prod]`) and are separate from the
// `.env.local` / Vercel variables the Next.js side reads — a key living in one
// does not put it in the other.
//
// Optional, not required: an unset key must surface as a recorded sync error
// on the affected product, not as a deployment that refuses to start.
export default defineApp({
  env: {
    STRIPE_SECRET_KEY: v.optional(v.string()),
  },
});
