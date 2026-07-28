import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isAdminClaims } from "./lib/admin-role";

// Next 16 renamed the `middleware.ts` convention to `proxy.ts`; this is still
// Clerk's `clerkMiddleware`, only the filename changed.
//
// `/admin` is the only authenticated surface on the site. Everything else —
// catalog, cart, checkout — is guest-only by design (CONTEXT.md "Guest
// checkout"), so it is never gated here.
const isAdminRoute = createRouteMatcher(["/admin(.*)"]);
// ...except the sign-in page itself, which lives under /admin so the store
// owner has a single URL to remember. Gating it would loop it against itself.
const isSignInRoute = createRouteMatcher(["/admin/sign-in(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isAdminRoute(req) || isSignInRoute(req)) {
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
