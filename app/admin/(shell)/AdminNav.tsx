"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The three screens the admin ever has (masterplan §7). Orders is `/admin`
// itself because it is the daily landing view, not a sub-page of one.
const LINKS = [
  { href: "/admin", label: "Orders" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/settings", label: "Settings" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav>
      <ul className="flex gap-6 text-sm">
        {LINKS.map((link) => {
          const isCurrent = pathname === link.href;
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
