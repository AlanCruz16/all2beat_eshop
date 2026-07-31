export function formatPriceCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
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
