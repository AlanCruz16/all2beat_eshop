// One pill, four tones — every /admin badge is this shape, and letting each
// screen hand-roll its own is how "Paid" ends up a different size from "Synced"
// two columns over.
export type BadgeTone = "attention" | "good" | "bad" | "neutral";

const TONES: Record<BadgeTone, string> = {
  attention:
    "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  good: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  bad: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  neutral: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export function Badge({
  tone,
  children,
}: {
  tone: BadgeTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
