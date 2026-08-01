import { describe, expect, test } from "vitest";
import { isAdminClaims, isGatedAdminPath } from "./admin-role";

// The Next-side half of the admin check (`convex/authz.ts` holds the
// authoritative half, tested in `authz.test.ts`). Worth its own tests since
// dropping Clerk's deprecated `createRouteMatcher` moved the path matching into
// this file — and a redirect that misses a path is a screen the owner reaches
// without a sign-in box, while one that over-matches is a sign-in loop.

describe("isAdminClaims", () => {
  test("only the admin role counts", () => {
    expect(isAdminClaims({ publicMetadata: { role: "admin" } })).toBe(true);
    expect(isAdminClaims({ publicMetadata: { role: "customer" } })).toBe(false);
    expect(isAdminClaims({ publicMetadata: {} })).toBe(false);
    expect(isAdminClaims(null)).toBe(false);
    expect(isAdminClaims(undefined)).toBe(false);
  });
});

describe("isGatedAdminPath", () => {
  test.each(["/admin", "/admin/", "/admin/products", "/admin/orders/abc123"])(
    "gates %s",
    (pathname) => {
      expect(isGatedAdminPath(pathname)).toBe(true);
    },
  );

  // Gating the sign-in page would redirect it to itself.
  test.each(["/admin/sign-in", "/admin/sign-in/factor-one"])(
    "lets %s through",
    (pathname) => {
      expect(isGatedAdminPath(pathname)).toBe(false);
    },
  );

  // The storefront is guest-only by design (CONTEXT.md "Guest checkout") and
  // must never be gated. `/administrators` is the trap a `/admin(.*)` pattern
  // falls into: a prefix match is not a path match.
  test.each(["/", "/shop", "/cart", "/checkout", "/administrators"])(
    "leaves %s alone",
    (pathname) => {
      expect(isGatedAdminPath(pathname)).toBe(false);
    },
  );
});
