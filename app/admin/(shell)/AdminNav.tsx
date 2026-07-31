"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The three screens the admin ever has (masterplan §7). Orders is `/admin`
// itself because it is the daily landing view, not a sub-page of one — but a
// single order lives at `/admin/orders/<id>`, so its tab needs a prefix to stay
// lit while one is open. Products is the same story once one is being edited.
// Settings matches exactly; it has no sub-pages.
const LINKS: Array<{ href: string; label: string; alsoUnder?: string }> = [
  { href: "/admin", label: "Orders", alsoUnder: "/admin/orders" },
  { href: "/admin/products", label: "Products", alsoUnder: "/admin/products" },
  { href: "/admin/settings", label: "Settings" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav>
      <ul className="flex gap-6 text-sm">
        {LINKS.map((link) => {
          const isCurrent =
            pathname === link.href ||
            (link.alsoUnder !== undefined &&
              pathname.startsWith(`${link.alsoUnder}/`));
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={isCurrent ? "page" : undefined}
                className={
                  isCurrent
                    ? "font-medium text-black dark:text-white"
                    : "text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white"
                }
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
