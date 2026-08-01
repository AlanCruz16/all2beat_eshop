export function formatPriceCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

// Money is stored in cents and typed in dollars, so /admin's price boxes need
// both directions. `toFixed(2)` rather than `formatPriceCents` because the
// value goes into an `<input type="number">`, which wants a bare number and not
// a currency symbol.
export function centsToAmountInput(cents: number | undefined): string {
  return cents === undefined ? "" : (cents / 100).toFixed(2);
}

// Returns null for a box that isn't a number at all, so the caller can tell
// "nothing entered" from "4.99". Rounding is what keeps 19.99 → 1999 rather
// than 1998 — binary floating point makes `19.99 * 100` 1998.9999999999998.
export function amountInputToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const dollars = Number(trimmed);
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
}

// Order timestamps in /admin. Safe to render in the viewer's own timezone
// because the screens that call it are client components whose first paint is
// a loading state — the server never renders a formatted date to disagree with.
export function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
