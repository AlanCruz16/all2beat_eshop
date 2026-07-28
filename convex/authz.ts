import type { Auth, UserIdentity } from "convex/server";

// The store has exactly one admin and no tiering (CONTEXT.md "Admin"), so
// authorization is a single string comparison — not a permissions table, not a
// role hierarchy. Keep it that way; multiple admins and permission tiers are an
// explicit non-goal of this build.
export const ADMIN_ROLE = "admin";

// Where the role lives in the JWT. Clerk copies `user.public_metadata` into
// this claim on both the session token (read by middleware/`auth()`) and the
// `convex` JWT template (read here) — see the ticket-08 notes in
// `.scratch/storefront-rebuild/issues/08-admin-access-shell.md`. A role
// anywhere *else* on the identity is not a role: only what Clerk itself put in
// this claim counts.
const ROLE_CLAIM = "publicMetadata";

function roleOf(identity: UserIdentity): string | null {
  const metadata = identity[ROLE_CLAIM];
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    return null;
  }
  const role = metadata.role;
  return typeof role === "string" ? role : null;
}

/**
 * The authorization boundary for every admin write in the app.
 *
 * Clerk middleware gates *navigation* to `/admin`; it does nothing about a
 * request made straight to Convex with a valid customer token, which is why
 * this re-derives identity and role from `ctx.auth` rather than trusting
 * anything the caller passed in. Every mutation reachable from `/admin` opens
 * with this call.
 *
 * Throws (rather than returning a boolean) so a forgotten `if` cannot silently
 * become an authorization hole.
 */
export async function requireAdmin(ctx: { auth: Auth }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new Error("Unauthorized: not signed in");
  }
  if (roleOf(identity) !== ADMIN_ROLE) {
    throw new Error("Unauthorized: not an admin");
  }
  return identity;
}
