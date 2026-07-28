import { SignIn } from "@clerk/nextjs";

// The one and only sign-in page on the site. It sits under `/admin` so the
// owner has a single URL to remember, but outside the `(shell)` route group so
// the shell's admin check does not 404 the page you go to in order to become
// an admin. Customers never see this — nothing on the storefront links here.
export default function AdminSignInPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <SignIn />
    </div>
  );
}
