"use client";

const BUTTON_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 text-lg leading-none disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700";

export function QuantityStepper({
  qty,
  max,
  onChange,
  label,
}: {
  qty: number;
  max: number;
  onChange: (qty: number) => void;
  // Distinguishes the control when several are on the page (one per cart line).
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={() => onChange(qty - 1)}
        disabled={qty <= 1}
        aria-label={`Decrease quantity of ${label}`}
      >
        −
      </button>
      <span className="w-8 text-center tabular-nums" aria-live="polite">
        {qty}
      </span>
      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={() => onChange(qty + 1)}
        disabled={qty >= max}
        aria-label={`Increase quantity of ${label}`}
      >
        +
      </button>
    </div>
  );
}
