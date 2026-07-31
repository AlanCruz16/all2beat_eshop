import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { isAdminClaims } from "@/lib/admin-role";
import { AdminNav } from "@/app/admin/(shell)/AdminNav";
import { AdminAuthed } from "@/app/admin/(shell)/AdminAuthed";

// Nothing under /admin belongs in a search index — least of all a login page
// for a store with exactly one account.
export const metadata = {
  title: "Store admin",
  robots: { index: false, follow: false },
};

// This layout wraps every admin screen but *not* `/admin/sign-in`, which sits
// outside the `(shell)` route group precisely so an unauthenticated owner can
// reach it without tripping the check below.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, sessionClaims } = await auth();

  // Middleware has already turned non-admins away by the time anyone gets
  // here. This repeats the check anyway: middleware is one config change or one
  // matcher typo away from not running, and a 404 is the right answer for a
  // page a non-admin should not know exists.
  if (userId === null || !isAdminClaims(sessionClaims)) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div>
          <h1 className="text-xl font-semibold">Store admin</h1>
          <p className="text-sm text-zinc-500">all2beat</p>
        </div>
        <UserButton />
      </header>
      <AdminNav />
      <div className="flex flex-1 flex-col">
        <AdminAuthed>{children}</AdminAuthed>
      </div>
    </div>
  );
}
