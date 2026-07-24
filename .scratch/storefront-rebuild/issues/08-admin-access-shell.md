# 08 — Admin access & shell

**What to build:** A locked door and an empty room behind it: `/admin` is the only place anyone logs in, and only the single admin can get in. This ticket establishes the Clerk gating, the flat role check, the admin layout the three screens will live in, and — critically — the server-side authorization helper that every write-mutation reuses, because middleware alone is not authorization.

**Blocked by:** 01 (can run in parallel with the storefront chain).

**Status:** ready-for-agent

- [ ] Clerk middleware protects `/admin/*`; customers never need an account anywhere else on the site
- [ ] Authorization is a flat role check (`sessionClaims.publicMetadata.role === "admin"`) — single admin, no tiers
- [ ] An admin layout/nav shell exists for the Orders / Products / Settings screens to slot into
- [ ] A reusable authorization helper independently verifies identity and role via `ctx.auth.getUserIdentity()` inside Convex, separate from middleware
- [ ] Seam 1 test: a guarded write-mutation is rejected for a non-admin or unauthenticated identity, independent of what middleware would have done
