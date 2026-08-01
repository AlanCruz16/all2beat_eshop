"use client";

import { useState } from "react";
import { ConvexError } from "convex/values";

// The pieces every /admin write form is built from, factored out of the Orders
// screen when the Products screen (ticket 10) needed the same ones — and added
// to when the Settings screen (ticket 11) needed the labelled field and the
// input styling a second time.

export const INPUT_CLASS =
  "w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900";

/**
 * A labelled box, with the sentence explaining it kept under the box rather
 * than in a tooltip — /admin has one reader and no room for hover-to-discover.
 *
 * The input is passed in rather than described, because these forms hold text
 * areas, number boxes, and selects, and a `type` prop would only grow.
 * `INPUT_CLASS` is exported for the caller to spread onto whatever it passes.
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-zinc-500">{label}</span>
      {children}
      {hint !== undefined && (
        <span className="block text-xs text-zinc-500">{hint}</span>
      )}
    </label>
  );
}


/**
 * An editable value seeded from one the server owns.
 *
 * Convex queries are live: a webhook, the sync engine, or a second tab can
 * change the record under the form, and `useState` alone would keep showing
 * what the field held when it mounted. Re-seeding during render (rather than
 * remounting on a `key`) is what lets the "Saved." feedback survive the query
 * update the save itself causes.
 *
 * `signature` is what "the server value changed" is judged on — for a single
 * field that is the value itself; for a form of them, a string built from all
 * of them.
 */
export function useServerBackedState<T>(value: T, signature: string) {
  const [draft, setDraft] = useState(value);
  const [seeded, setSeeded] = useState(signature);
  if (seeded !== signature) {
    setSeeded(signature);
    setDraft(value);
  }
  return [draft, setDraft] as const;
}

/**
 * The `signature` above, built from the server values a form is seeded from.
 *
 * Lives here rather than in each screen because it is `useServerBackedState`'s
 * own concept: what counts as "the record changed" is the list of values passed
 * in, and every caller was otherwise hand-rolling the same `JSON.stringify`.
 */
export function signatureOf(...values: unknown[]): string {
  return JSON.stringify(values);
}

/**
 * A submit that reports what it is doing, with any failure said out loud rather
 * than swallowed.
 *
 * Every admin mutation throws on an unauthorized caller (`requireAdmin`) and
 * the product ones throw on invalid input besides — both worth showing, because
 * a silently-ignored click looks like the record simply didn't save.
 */
export function useSubmit(run: () => Promise<unknown>) {
  const [state, setState] = useState<
    { status: "idle" | "saving" | "saved" } | { status: "error"; message: string }
  >({ status: "idle" });

  async function submit() {
    setState({ status: "saving" });
    try {
      await run();
      setState({ status: "saved" });
    } catch (error) {
      console.error(error);
      setState({
        status: "error",
        message: errorMessage(error),
      });
    }
  }

  return { state, submit };
}

// A `ConvexError`'s payload is the one part of a failed mutation Convex will
// carry to the browser in production — everything else is redacted to "Server
// Error". The admin mutations throw their owner-readable messages that way
// (`reject` in `convex/products.ts`), so a string payload is a message meant to
// be shown; anything else is a fault, which belongs in the console.
function errorMessage(error: unknown): string {
  const data: unknown =
    error instanceof ConvexError ? (error.data as unknown) : undefined;
  return typeof data === "string" ? data : "Something went wrong";
}

/**
 * Says how the last submit went. An omitted `savedLabel` reports failures only
 * — for a control whose own appearance is the confirmation, like a toggle whose
 * label flips the moment the live query catches up.
 */
export function SubmitFeedback({
  state,
  savedLabel,
}: {
  state: ReturnType<typeof useSubmit>["state"];
  savedLabel?: string;
}) {
  if (state.status === "error") {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {state.message}
      </p>
    );
  }
  if (state.status === "saved" && savedLabel !== undefined) {
    return <p className="text-sm text-zinc-500">{savedLabel}</p>;
  }
  return null;
}
