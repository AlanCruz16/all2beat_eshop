"use client";

import { useState } from "react";
import { ConvexError } from "convex/values";

// The three pieces every /admin write form is built from, factored out of the
// Orders screen when the Products screen (ticket 10) needed the same three.

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
