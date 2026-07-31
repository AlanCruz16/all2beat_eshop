import type { Doc } from "@/convex/_generated/dataModel";

export type SyncStatus = Doc<"products">["syncStatus"];

// A product's mirror state in Stripe (CONTEXT.md "Sync status"). `error` is
// not a warning about tidiness — checkout prices its lines from the mirrored
// Stripe Price, so a product in that state cannot be sold at all, and the badge
// says so in those words rather than in Stripe's.
const LABEL: Record<SyncStatus, string> = {
  pending: "Syncing…",
  synced: "Synced",
  error: "Can't be sold",
};

const STYLE: Record<SyncStatus, string> = {
  pending:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  synced: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export function SyncStatusBadge({ status }: { status: SyncStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${STYLE[status]}`}
    >
      {LABEL[status]}
    </span>
  );
}
