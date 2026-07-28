// The Next-side half of the admin check. The authoritative half lives in
// `convex/authz.ts` — this one only decides what the browser is allowed to
// *navigate* to. Both read the same claim in the same flat way (CONTEXT.md
// "Admin": one admin, no tiers).

export const ADMIN_ROLE = "admin";

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
