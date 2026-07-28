/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

// Seam 1 (spec "Testing Decisions" → "Admin mutation authorization"). These
// exercise the guarded mutation directly, with no middleware anywhere in the
// picture — that is the point. Clerk middleware can be misconfigured, bypassed
// by a direct Convex call, or simply not run at all; the server-side check is
// what actually keeps a non-admin out.
const adminIdentity = {
  subject: "user_admin",
  issuer: "https://clerk.test",
  email: "owner@all2beat.com",
  publicMetadata: { role: "admin" },
};

describe("requireAdmin, via a guarded write-mutation", () => {
  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);

    await expect(t.mutation(api.admin.assertAdminAccess, {})).rejects.toThrow(
      /not signed in/i,
    );
  });

  test("rejects a signed-in identity carrying no role", async () => {
    const t = convexTest(schema, modules);
    const asCustomer = t.withIdentity({
      subject: "user_customer",
      issuer: "https://clerk.test",
    });

    await expect(
      asCustomer.mutation(api.admin.assertAdminAccess, {}),
    ).rejects.toThrow(/not an admin/i);
  });

  test("rejects a signed-in identity whose role is not admin", async () => {
    const t = convexTest(schema, modules);
    const asCustomer = t.withIdentity({
      ...adminIdentity,
      subject: "user_customer",
      publicMetadata: { role: "customer" },
    });

    await expect(
      asCustomer.mutation(api.admin.assertAdminAccess, {}),
    ).rejects.toThrow(/not an admin/i);
  });

  test("rejects a role smuggled in somewhere other than publicMetadata", async () => {
    const t = convexTest(schema, modules);
    const asImpostor = t.withIdentity({
      subject: "user_impostor",
      issuer: "https://clerk.test",
      role: "admin",
    });

    await expect(
      asImpostor.mutation(api.admin.assertAdminAccess, {}),
    ).rejects.toThrow(/not an admin/i);
  });

  test("admits the admin and reports the identity it authorized", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(adminIdentity);

    await expect(asAdmin.mutation(api.admin.assertAdminAccess, {})).resolves
      .toEqual({
        subject: "user_admin",
        email: "owner@all2beat.com",
      });
  });
});
