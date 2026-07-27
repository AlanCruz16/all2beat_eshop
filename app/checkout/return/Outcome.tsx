import Link from "next/link";

// The one shape every ending of a checkout takes — paid, abandoned, expired,
// or unconfirmable. Shared with the page itself, which renders the
// no-session-id case without needing the client component at all.
export function Outcome({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <h2 className="text-xl font-medium">{heading}</h2>
      <p className="text-zinc-600 dark:text-zinc-400">{body}</p>
      <Link href="/shop" className="underline">
        Back to the shop
      </Link>
    </div>
  );
}

export const UNCONFIRMED = {
  heading: "We couldn't confirm this order",
  body: "If you were charged, your confirmation email from Stripe is the record of it. Please get in touch and we'll sort it out.",
};
