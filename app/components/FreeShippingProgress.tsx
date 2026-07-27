import { formatPriceCents } from "@/lib/format";
import type { FreeShippingProgress as Progress } from "@/lib/cart";

// The threshold comes from the `settings` table, never a constant — the store
// owner edits it in /admin without a deploy (ADR-0004).
export function FreeShippingProgress({ progress }: { progress: Progress }) {
  // A zero threshold (free shipping always) has no progress to show — the bar
  // is simply full, and dividing by it would give NaN.
  const pct =
    progress.thresholdCents <= 0
      ? 100
      : Math.min(
          100,
          Math.round(
            ((progress.thresholdCents - progress.remainingCents) /
              progress.thresholdCents) *
              100,
          ),
        );

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        {progress.qualified ? (
          <span className="font-medium text-green-700 dark:text-green-400">
            You’ve unlocked free shipping.
          </span>
        ) : (
          <>
            <span className="font-medium">
              {formatPriceCents(progress.remainingCents)}
            </span>{" "}
            more for free shipping.
          </>
        )}
      </p>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progress towards free shipping"
      >
        <div
          className="h-full rounded-full bg-green-600 transition-[width] dark:bg-green-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
