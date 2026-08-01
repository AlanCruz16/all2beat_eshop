"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { amountInputToCents, centsToAmountInput, formatPriceCents } from "@/lib/format";
import {
  Field,
  INPUT_CLASS,
  signatureOf as signatureFrom,
  SubmitFeedback,
  useServerBackedState,
  useSubmit,
} from "../adminForm";

type Settings = NonNullable<FunctionReturnType<typeof api.settings.get>>;

// Four values, and no more (ticket 11). The amounts are held as text for the
// same reason the product form holds its prices that way: a half-typed "4." is
// a state the box has to be able to sit in, so parsing happens once, on save.
type Draft = {
  taxEnabled: boolean;
  shippingFlatRate: string;
  freeShippingThreshold: string;
  contactEmail: string;
};

// The defaults `seedDefaults` would have written, so a deployment that was
// never seeded still opens on a fillable form rather than a dead end — the save
// inserts the row in that case.
const UNSEEDED_DRAFT: Draft = {
  taxEnabled: false,
  shippingFlatRate: "5.00",
  freeShippingThreshold: "25.00",
  contactEmail: "",
};

function draftFrom(settings: Settings | null): Draft {
  if (settings === null) {
    return UNSEEDED_DRAFT;
  }
  return {
    taxEnabled: settings.taxEnabled,
    shippingFlatRate: centsToAmountInput(settings.shippingFlatRateCents),
    freeShippingThreshold: centsToAmountInput(
      settings.freeShippingThresholdCents,
    ),
    contactEmail: settings.contactEmail,
  };
}

// What "the server row changed" is judged on (see `useServerBackedState`) —
// Convex queries are live, and a second tab saving must not leave this form
// showing what it held when it mounted.
function signatureOf(settings: Settings | null): string {
  // The unseeded case is its own signature, so the first save — which inserts
  // the row — reseeds the form from what the server now holds.
  return settings === null
    ? signatureFrom(null)
    : signatureFrom(
        settings.taxEnabled,
        settings.shippingFlatRateCents,
        settings.freeShippingThresholdCents,
        settings.contactEmail,
      );
}

// The shipping rule the two amounts add up to, said back in one sentence,
// because the pair is easy to set into a combination nobody meant — a threshold
// below the rate, say, or a threshold of zero that quietly makes every order
// ship free.
function ShippingSummary({ draft }: { draft: Draft }) {
  const rateCents = amountInputToCents(draft.shippingFlatRate);
  const thresholdCents = amountInputToCents(draft.freeShippingThreshold);
  if (rateCents === null || thresholdCents === null) {
    return null;
  }
  return (
    <p className="text-xs text-zinc-500">
      {rateCents === 0 || thresholdCents === 0
        ? "Every order ships free."
        : `Orders under ${formatPriceCents(thresholdCents)} pay ${formatPriceCents(rateCents)} shipping; at or above it, shipping is free.`}
    </p>
  );
}

function EditForm({ settings }: { settings: Settings | null }) {
  const save = useMutation(api.settings.save);
  const [draft, setDraft] = useServerBackedState(
    draftFrom(settings),
    signatureOf(settings),
  );

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft({ ...draft, [key]: value });
  }

  const { state, submit } = useSubmit(async () => {
    const shippingFlatRateCents = amountInputToCents(draft.shippingFlatRate);
    if (shippingFlatRateCents === null) {
      throw new ConvexError("Shipping rate must be an amount, like 5.00");
    }
    const freeShippingThresholdCents = amountInputToCents(
      draft.freeShippingThreshold,
    );
    if (freeShippingThresholdCents === null) {
      throw new ConvexError(
        "Free-shipping threshold must be an amount, like 25.00",
      );
    }

    await save({
      taxEnabled: draft.taxEnabled,
      shippingFlatRateCents,
      freeShippingThresholdCents,
      contactEmail: draft.contactEmail,
    });
  });

  return (
    <form
      className="max-w-xl space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {settings === null && (
        <p
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          This store has no settings yet, so checkout will refuse to run. Fill
          these in and save to create them.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Shipping rate (USD)" hint="Charged per order, not per item.">
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.shippingFlatRate}
            onChange={(event) => set("shippingFlatRate", event.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
        <Field
          label="Free-shipping threshold (USD)"
          hint="Order subtotals at or above this ship free."
        >
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.freeShippingThreshold}
            onChange={(event) =>
              set("freeShippingThreshold", event.target.value)
            }
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <ShippingSummary draft={draft} />

      <Field
        label="Contact email"
        hint="Shown on the contact page as the address customers write to."
      >
        <input
          type="email"
          value={draft.contactEmail}
          onChange={(event) => set("contactEmail", event.target.value)}
          className={INPUT_CLASS}
        />
      </Field>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.taxEnabled}
          onChange={(event) => set("taxEnabled", event.target.checked)}
          className="mt-1"
        />
        <span>
          Collect sales tax — leave this off until your accountant confirms
          you&apos;re registered to collect in a state. Turning it on has Stripe
          calculate tax at checkout; it needs your Stripe Tax settings to be
          configured first.
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={state.status === "saving"}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Save settings
        </button>
        <SubmitFeedback state={state} savedLabel="Saved." />
      </div>
    </form>
  );
}

export function SettingsForm() {
  const settings = useQuery(api.settings.get, {});

  if (settings === undefined) {
    return <p className="text-sm text-zinc-500">Loading settings…</p>;
  }

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-lg font-medium">Settings</h2>
        {/* Why this screen exists at all (ADR-0004): these are the numbers the
            owner would otherwise have to ask a developer to redeploy. */}
        <p className="text-sm text-zinc-500">
          These take effect on the next checkout — no redeploy, and nothing to
          change in the Stripe Dashboard.
        </p>
      </div>

      <EditForm settings={settings} />
    </section>
  );
}
