"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Section links with active-state highlighting so the user always knows
// where they are. A link is active on its own page and any page nested
// under it (e.g. Projects stays active on /projects/[id]); Home only on "/"
// exactly, since every route is technically "under" it.
const LINKS = [
  { href: "/", label: "Home", exact: true },
  { href: "/projects", label: "Projects" },
  { href: "/estimates", label: "Estimates" },
  { href: "/search", label: "Search" },
];

export function MainNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-4 sm:gap-6">
      <Link href="/" className="font-semibold">
        Estimator
      </Link>
      {LINKS.map((link) => {
        const active = link.exact
          ? pathname === link.href
          : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "text-sm transition-colors hover:text-foreground",
              // Home is hidden on mobile since the logo already links home.
              link.href === "/" && "hidden sm:inline",
              active ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
