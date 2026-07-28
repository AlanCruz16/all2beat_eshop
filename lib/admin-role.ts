// The Next-side half of the admin check. The authoritative half lives in
// `convex/authz.ts` — this one only decides what the browser is allowed to
// *navigate* to. Both read the same claim in the same flat way (CONTEXT.md
// "Admin": one admin, no tiers).

// The store has exactly one admin and no tiering (CONTEXT.md "Admin"), so
// authorization is a single string comparison — not a permissions table, not a
// role hierarchy. Keep it that way; multiple admins and permission tiers are an
// explicit non-goal of this build.
export const ADMIN_ROLE = "admin";

// Where the role lives in the JWT. Clerk copies `user.public_metadata` into
// this claim on both the session token (read here) and the `convex` JWT
// template (read by `convex/authz.ts`). Both halves import these two constants
// so renaming the claim can never half-land: the checks are independent on
// purpose, the spelling of the claim is not.
export const ROLE_CLAIM = "publicMetadata";

declare global {
  // Clerk types `sessionClaims` from this interface. `publicMetadata` is not a
  // default claim: it is added to the session token in the Clerk Dashboard as
  // `{{user.public_metadata}}`, and to the `convex` JWT template alongside it.
  interface CustomJwtSessionClaims {
    publicMetadata?: {
      role?: string;
    };
  }
}

/**
 * True only for the store owner. Anonymous visitors and any signed-in user
 * without the role are both non-admins — there is no partial admin state.
 */
export function isAdminClaims(
  claims: CustomJwtSessionClaims | null | undefined,
): boolean {
  return claims?.publicMetadata?.role === ADMIN_ROLE;
}
