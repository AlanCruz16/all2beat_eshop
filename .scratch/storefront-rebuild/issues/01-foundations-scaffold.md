# 01 — Foundations & scaffold

**What to build:** A deployed, empty-but-wired app: the Next.js + Convex + Clerk substrate every later ticket hangs off. The full data model exists, the `settings` singleton is seeded so checkout can read it in Phase 3, admin auth is wired, and the Seam 1 test harness runs. Anyone picking up a later ticket starts from a working, deployed baseline.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] `create-next-app` (TypeScript, App Router, Tailwind), Convex, and Clerk initialised and running locally
- [x] `convex/schema.ts` defines all five tables (`products`, `reservations`, `orders`, `stripeEvents`, `settings`) with the indexes per masterplan §4
- [x] The `settings` singleton row is seeded with defaults (tax off, $5.00 shipping, $25.00 free-shipping threshold, contact email) and cannot be duplicated — Phase 3 depends on it existing (ADR-0004)
- [x] Clerk ↔ Convex auth wiring in place (`convex/auth.config.ts`) so identity is available inside Convex functions
- [x] `.env.example` committed with every required variable; real secrets gitignored
- [x] The Seam 1 `convex-test` harness is set up and runs in CI/local with at least one smoke test that exercises a Convex query against seeded data
- [x] An empty app is deployed to Vercel, and a deployed page reads a seeded row from Convex prod

## Comments

Implemented 2026-07-24. Notes for whoever picks up ticket 08 (admin access shell) or later:

- Convex dev deployment: `groovy-meerkat-266` (team `adagocd`, project `all2beat-eshop`). Prod deployment: `gregarious-basilisk-363`.
- Production site: https://all2beateshop.vercel.app — homepage is a Server Component reading `api.settings.get` via `fetchQuery` from `convex/nextjs`, confirming the seeded settings row is reachable from Convex prod.
- `settings.seedDefaults` (`convex/settings.ts`) is an idempotent `internalMutation` — safe to re-run, guards against duplicate rows by checking for an existing row first. Reproducible via `npm run seed` (runs against whatever deployment `npx convex` is currently pointed at; pass `--prod` for the production deployment).
- `CLERK_JWT_ISSUER_DOMAIN` must be set as a Convex environment variable on **both** the dev and prod deployments (`npx convex env set CLERK_JWT_ISSUER_DOMAIN <issuer-url> [--prod]`) — it's read server-side by `convex/auth.config.ts`, separate from `.env.local`/Vercel env vars which only cover the Next.js side.
- Admin role-check middleware, the reusable Convex authorization helper, and the `/admin` layout are explicitly out of scope here — that's ticket 08. This ticket only wires identity plumbing (`ConvexProviderWithClerk` in `app/ConvexClientProvider.tsx`) so `ctx.auth.getUserIdentity()` works inside Convex functions.
- Code review (Standards + Spec axes) surfaced two fixes applied before commit: the homepage was needlessly a Client Component (converted to a Server Component per the "prefer Server Components" convention), and there was no committed way to reproduce the settings seed (added `npm run seed`).
