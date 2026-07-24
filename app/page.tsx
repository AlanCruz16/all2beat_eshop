import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export default async function Home() {
  const settings = await fetchQuery(api.settings.get);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 p-16 font-sans dark:bg-black">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        all2beat
      </h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        {settings === null
          ? "No settings row found — run the seed mutation."
          : `Contact us at ${settings.contactEmail}`}
      </p>
    </div>
  );
}
