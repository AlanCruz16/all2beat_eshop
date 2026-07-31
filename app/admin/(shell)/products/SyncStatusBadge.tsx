import type { Doc } from "@/convex/_generated/dataModel";
import { Badge, type BadgeTone } from "../Badge";

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

const TONES: Record<SyncStatus, BadgeTone> = {
  pending: "attention",
  synced: "good",
  error: "bad",
};

export function SyncStatusBadge({ status }: { status: SyncStatus }) {
  return <Badge tone={TONES[status]}>{LABEL[status]}</Badge>;
}
