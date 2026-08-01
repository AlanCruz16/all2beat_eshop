import { ConvexError } from "convex/values";

// What /admin's write mutations do with a value the store owner typed that
// can't be accepted. Shared by the Products and Settings screens (tickets 10,
// 11), because the rule is the same in both and it is the reasoning below —
// not the three lines — that must not be re-derived a third time.

/**
 * Refuses a write with a message written to be read by the store owner.
 *
 * `ConvexError`, not `Error`: Convex redacts a plain thrown message to "Server
 * Error" in production, and these messages are shown verbatim by the forms —
 * thrown any other way they arrive on the deployed site as nothing at all.
 */
export function reject(message: string): never {
  throw new ConvexError(message);
}

/**
 * A count the owner typed: whole, and no smaller than `minimum`.
 *
 * Used for cents as well as units — money is stored as an integer number of
 * cents, so "a whole number" is the same demand in both cases.
 */
export function requireCount(
  label: string,
  value: number,
  minimum: number,
): void {
  if (!Number.isInteger(value) || value < minimum) {
    reject(
      `${label} must be a whole number of at least ${minimum} (got ${value})`,
    );
  }
}
