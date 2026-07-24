import type { Metadata } from "next";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export const metadata: Metadata = {
  title: "Contact — all2beat",
};

export default async function ContactPage() {
  const settings = await fetchQuery(api.settings.get);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="mb-6 text-2xl font-semibold">Contact</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        {settings === null
          ? "Contact details are temporarily unavailable."
          : `Questions about an order or our bars? Reach us at ${settings.contactEmail}.`}
      </p>
    </div>
  );
}
