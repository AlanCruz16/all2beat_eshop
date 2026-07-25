import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — all2beat",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="mb-6 text-2xl font-semibold">About all2beat</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        all2beat makes vegan snack bars in Tucson, Arizona. We&rsquo;re a
        small batch, straightforward-ingredients kind of operation — more
        copy coming soon.
      </p>
    </div>
  );
}
