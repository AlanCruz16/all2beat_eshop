import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireAdmin } from "./authz";

/**
 * A write-path probe for the authorization boundary: it takes the mutation
 * path, verifies the caller is the admin, and touches nothing.
 *
 * It exists because the guarantee "an admin mutation rejects a non-admin" is
 * worth a test of its own, ahead of and independent of the real admin writes
 * that tickets 09–11 add. Those mutations open exactly like this one; if this
 * test goes red, so has every one of them.
 */
export const assertAdminAccess = mutation({
  args: {},
  returns: v.object({
    // `tokenIdentifier`, not `subject` — it is the identifier that is unique
    // across providers, and it is the one 09–11 should key off if they ever
    // need to record who did something.
    tokenIdentifier: v.string(),
    email: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    const identity = await requireAdmin(ctx);
    return { tokenIdentifier: identity.tokenIdentifier, email: identity.email };
  },
});
