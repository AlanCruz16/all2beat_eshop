import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isAdminClaims, isGatedAdminPath } from "./lib/admin-role";

// Next 16 renamed the `middleware.ts` convention to `proxy.ts`; this is still
// Clerk's `clerkMiddleware`, only the filename changed.
//
// `/admin` is the only authenticated surface on the site. Everything else —
// catalog, cart, checkout — is guest-only by design (CONTEXT.md "Guest
// checkout"), so it is never gated here. The sign-in page itself is the one
// exception under `/admin`: it lives there so the store owner has a single URL
// to remember, and gating it would loop it against itself.
//
// Which paths that covers is `isGatedAdminPath` in `lib/admin-role.ts`, beside
// the role check it pairs with — matched on the pathname directly rather than
// with Clerk's `createRouteMatcher`, which they deprecated in favour of
// checking auth in the resource itself. This middleware is not that check: it
// is the redirect that gets the owner to a sign-in box. The authorization
// proper is `app/admin/(shell)/layout.tsx`, which re-derives identity and 404s,
// and `requireAdmin` inside every Convex function, which a request made
// straight to Convex has to pass and this file never sees (masterplan §7:
// enforced in both).
export default clerkMiddleware(async (auth, req) => {
  if (!isGatedAdminPath(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const { userId, sessionClaims, redirectToSignIn } = await auth();

  if (userId === null) {
    return redirectToSignIn({ returnBackUrl: req.url });
  }

  // Signed in, but not the owner. Send them back to the storefront rather than
  // to sign-in: signing in again would not change the answer. This is a
  // navigation convenience, not the authorization — `/admin/layout.tsx` 404s
  // independently, and every admin mutation re-checks in Convex.
  if (!isAdminClaims(sessionClaims)) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next internals and static files unless they appear in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes and Clerk's own frontend API routes.
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
