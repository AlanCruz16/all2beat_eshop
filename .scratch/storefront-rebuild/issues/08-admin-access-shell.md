# 08 — Admin access & shell

**What to build:** A locked door and an empty room behind it: `/admin` is the only place anyone logs in, and only the single admin can get in. This ticket establishes the Clerk gating, the flat role check, the admin layout the three screens will live in, and — critically — the server-side authorization helper that every write-mutation reuses, because middleware alone is not authorization.

**Blocked by:** 01 (can run in parallel with the storefront chain).

**Status:** done

- [x] Clerk middleware protects `/admin/*`; customers never need an account anywhere else on the site
- [x] Authorization is a flat role check (`sessionClaims.publicMetadata.role === "admin"`) — single admin, no tiers
- [x] An admin layout/nav shell exists for the Orders / Products / Settings screens to slot into
- [x] A reusable authorization helper independently verifies identity and role via `ctx.auth.getUserIdentity()` inside Convex, separate from middleware
- [x] Seam 1 test: a guarded write-mutation is rejected for a non-admin or unauthenticated identity, independent of what middleware would have done

## Comments

Implemented 2026-07-27. Notes for whoever picks up 09 / 10 / 11:

- **The helper is `requireAdmin(ctx)` in `convex/authz.ts`.** Every admin mutation opens with `await requireAdmin(ctx)`. It throws rather than returning a boolean, so a forgotten `if` cannot become a hole. It accepts `{ auth }`, so it works in queries, mutations, and actions alike.
- **`convex/admin.ts` holds `assertAdminAccess`** — a mutation that verifies the caller and touches nothing. It exists so the "admin mutation rejects a non-admin" guarantee has a test subject of its own, ahead of the real admin writes in 09–11. It is not scaffolding to delete: if it goes red, so has every mutation those tickets add.
- **Two role checks, deliberately.** `lib/admin-role.ts` (`isAdminClaims`) decides what the browser may navigate to; `convex/authz.ts` decides what may actually be written. Neither trusts the other — a direct Convex call from a valid customer token never passes through the proxy at all.
- **Clerk Dashboard configuration is required and is not in the repo:**
  - The owner's Clerk user needs `{"role": "admin"}` in **public metadata**.
  - The **session token** needs a custom claim `publicMetadata` = `{{user.public_metadata}}` (read by the proxy and by `auth()` in the layout).
  - The **`convex` JWT template** needs the same `publicMetadata` claim (read by `requireAdmin`).
  Without the claims, a correctly-configured admin user is treated as a non-admin everywhere — which is the safe failure direction, but it looks like a bug.
- **`NEXT_PUBLIC_CLERK_SIGN_IN_URL=/admin/sign-in`** is now required (added to `.env.example` and `.env.local`; set it in Vercel too). Without it, Clerk redirects to its own hosted sign-in page instead of ours.
- **Next 16 renamed `middleware.ts` to `proxy.ts`** — the file is `proxy.ts` at the repo root. Same `clerkMiddleware`, same matcher, deprecation warning gone.
- **Route layout:** admin screens live under `app/admin/(shell)/`, so the guarded layout wraps them but *not* `app/admin/sign-in/`. Putting sign-in inside the shell would 404 the page you visit in order to become an admin. `/admin` itself is the Orders landing (ticket 09 fills the page in); `/admin/products` and `/admin/settings` are stubs for 10 and 11.
- **Verified on a running dev server**, not just in tests: unauthenticated `GET /admin` → 307 to `/admin/sign-in?redirect_url=…`; `/admin/sign-in` → 200; `/shop` → 200 (ungated, as guest checkout requires).
- **One pre-existing hole closed while here:** `products.seedProducts` was a *public* action that writes products and stores blobs — anyone with the deployment URL could call it. It is now an `internalAction`; `npm run seed` still works, because `convex run` authenticates with deployment credentials. Found by the spec-axis code review, which read this ticket's "every write-mutation reuses the helper" as covering it.
- **Sign-up should be restricted in the Clerk Dashboard** (Restrictions → sign-up mode). Nothing on the site links to sign-up, but the store has exactly one admin and self-serve account creation has no purpose here.
