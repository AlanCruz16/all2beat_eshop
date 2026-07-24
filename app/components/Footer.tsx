export function Footer() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-5xl flex-col gap-1 px-6 py-8 text-sm text-zinc-500 dark:text-zinc-400">
        <p>all2beat — vegan snack bars, made in Tucson, Arizona.</p>
        <p>&copy; {new Date().getFullYear()} all2beat. All rights reserved.</p>
      </div>
    </footer>
  );
}
