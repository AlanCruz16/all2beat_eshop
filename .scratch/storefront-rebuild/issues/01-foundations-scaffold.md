# 01 — Foundations & scaffold

**What to build:** A deployed, empty-but-wired app: the Next.js + Convex + Clerk substrate every later ticket hangs off. The full data model exists, the `settings` singleton is seeded so checkout can read it in Phase 3, admin auth is wired, and the Seam 1 test harness runs. Anyone picking up a later ticket starts from a working, deployed baseline.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `create-next-app` (TypeScript, App Router, Tailwind), Convex, and Clerk initialised and running locally
- [ ] `convex/schema.ts` defines all five tables (`products`, `reservations`, `orders`, `stripeEvents`, `settings`) with the indexes per masterplan §4
- [ ] The `settings` singleton row is seeded with defaults (tax off, $5.00 shipping, $25.00 free-shipping threshold, contact email) and cannot be duplicated — Phase 3 depends on it existing (ADR-0004)
- [ ] Clerk ↔ Convex auth wiring in place (`convex/auth.config.ts`) so identity is available inside Convex functions
- [ ] `.env.example` committed with every required variable; real secrets gitignored
- [ ] The Seam 1 `convex-test` harness is set up and runs in CI/local with at least one smoke test that exercises a Convex query against seeded data
- [ ] An empty app is deployed to Vercel, and a deployed page reads a seeded row from Convex prod
