import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 p-16 font-sans dark:bg-black">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        all2beat
      </h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Vegan snack bars, made in Tucson, Arizona.
      </p>
      <Link
        href="/shop"
        className="rounded-full bg-black px-6 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
      >
        Shop now
      </Link>
    </div>
  );
}
