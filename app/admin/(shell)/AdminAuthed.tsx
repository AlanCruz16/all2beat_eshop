"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";

/**
 * Holds the admin screens back until Convex itself has an authenticated
 * identity.
 *
 * The layout's server-side check (Clerk `auth()`) says the *browser* may be
 * here; it says nothing about the Convex websocket, which authenticates
 * separately and a moment later. Every admin query opens with `requireAdmin`,
 * so a query fired in that gap throws "Unauthorized: not signed in" — the
 * screens must not mount until the token has landed.
 *
 * `Unauthenticated` should be unreachable behind the layout's check, so it is
 * treated as the configuration fault it almost certainly is: the `convex` JWT
 * template is what carries Clerk's identity to Convex, and a deployment missing
 * it lands here forever rather than on a screen.
 */
export function AdminAuthed({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthLoading>
        <p className="text-sm text-zinc-500">Signing in…</p>
      </AuthLoading>
      <Unauthenticated>
        <p className="text-sm text-zinc-500">
          Signed in, but Convex hasn&apos;t accepted this session. Check that
          the <code>convex</code> JWT template exists in the Clerk Dashboard and
          that <code>CLERK_JWT_ISSUER_DOMAIN</code> is set on this deployment.
        </p>
      </Unauthenticated>
      <Authenticated>{children}</Authenticated>
    </>
  );
}
