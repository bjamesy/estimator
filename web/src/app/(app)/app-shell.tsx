"use client";

import {
  ChevronDownIcon,
  FileTextIcon,
  FolderIcon,
  MenuIcon,
  SearchIcon,
  ShieldCheckIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { logout } from "@/app/actions/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Item = { id: string; name: string };

const PRIMARY_NAV = [
  { href: "/search", label: "Search", icon: SearchIcon, exact: false, shortcut: "⌘K" },
  {
    href: "/credentials",
    label: "Credentials",
    icon: ShieldCheckIcon,
    exact: false,
    shortcut: undefined,
  },
];

// Shared pill styling for an active vs. inactive sidebar row.
function rowClass(active: boolean) {
  return cn(
    "transition-colors",
    active
      ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground"
      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
  );
}

export function AppShell({
  account,
  projects,
  estimates,
  children,
}: {
  account: string | null;
  projects: Item[];
  estimates: Item[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Close the mobile drawer on route change so a nav tap doesn't leave it
  // hanging open over the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Global ⌘K / Ctrl+K jumps to search from anywhere; the search input there
  // autofocuses on arrival, so the shortcut lands the cursor ready to type.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        router.push("/search");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const sidebar = (
    <div className="flex h-full flex-col gap-4 p-4">
      <Link href="/" className="px-2 text-lg font-semibold text-primary">
        Estimator
      </Link>

      {/* One flat, evenly-spaced nav -- Search/Credentials and the
          collapsible Projects/Estimates rows are all peers, not separate
          groups, so they share a single gap rather than being split across
          two containers with different spacing. */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {PRIMARY_NAV.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
                rowClass(active),
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
              {item.shortcut && (
                <kbd className="ml-auto hidden rounded border border-current/25 px-1.5 py-0.5 text-[10px] font-medium opacity-70 md:inline-block">
                  {item.shortcut}
                </kbd>
              )}
            </Link>
          );
        })}

        <CollapsibleNavSection
          title="Projects"
          icon={FolderIcon}
          listHref="/projects"
          basePath="/projects"
          items={projects}
          emptyLabel="No projects yet"
          pathname={pathname}
        />
        <CollapsibleNavSection
          title="Estimates"
          icon={FileTextIcon}
          listHref="/estimates"
          basePath="/estimates"
          items={estimates}
          emptyLabel="No estimates yet"
          pathname={pathname}
        />
      </nav>
    </div>
  );

  return (
    <div className="flex min-h-svh">
      {/* Desktop sidebar -- pinned full-height so it stays put while the
          content scrolls; its own list area scrolls internally. */}
      <aside className="hidden h-svh w-64 shrink-0 self-start border-r bg-sidebar md:sticky md:top-0 md:block">
        {sidebar}
      </aside>

      {/* Mobile drawer -- always mounted so it slides; pointer-events off
          when closed so it doesn't block the page. */}
      <div
        className={cn(
          "fixed inset-0 z-50 md:hidden",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <div
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity",
            open ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setOpen(false)}
        />
        <aside
          className={cn(
            "absolute inset-y-0 left-0 w-72 border-r bg-sidebar transition-transform duration-200",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close menu"
            className="absolute right-2 top-2"
            onClick={() => setOpen(false)}
          >
            <XIcon className="size-5" />
          </Button>
          {sidebar}
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top navbar: account identity + controls on the right at every
            size; the hamburger + wordmark on the left only on mobile, where
            the sidebar is hidden behind the drawer. */}
        <header className="sticky top-0 z-30 flex items-center border-b bg-background px-4 py-3">
          <div className="flex items-center gap-3 md:hidden">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Open menu"
              onClick={() => setOpen(true)}
            >
              <MenuIcon className="size-5" />
            </Button>
            <Link href="/" className="font-semibold text-primary">
              Estimator
            </Link>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {account && (
              <span className="hidden max-w-[16rem] truncate text-sm text-muted-foreground sm:inline">
                {account}
              </span>
            )}
            <ThemeToggle />
            <form action={logout}>
              <Button type="submit" variant="ghost" size="sm">
                Log out
              </Button>
            </form>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">{children}</main>

        <footer className="border-t px-4 py-4 sm:px-6">
          <p className="text-center text-sm text-muted-foreground">
            Questions or feedback?{" "}
            <a
              href="mailto:jameswballanger@gmail.com"
              className="text-foreground transition-colors hover:text-primary"
            >
              Get in touch
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}

// A top-level nav row (icon + label, styled like Search/Credentials above
// it) that expands into its child projects/estimates rather than always
// showing every one of them -- a company with a dozen estimates shouldn't
// push Credentials off screen. The label still links to the full list page;
// the chevron independently toggles the child list. Auto-expands when the
// current route is inside the section, but never auto-collapses a section
// the user opened manually (fighting a manual toggle reads as broken).
function CollapsibleNavSection({
  title,
  icon: Icon,
  listHref,
  basePath,
  items,
  emptyLabel,
  pathname,
}: {
  title: string;
  icon: LucideIcon;
  listHref: string;
  basePath: string;
  items: Item[];
  emptyLabel: string;
  pathname: string;
}) {
  const withinSection = pathname === listHref || pathname.startsWith(`${basePath}/`);
  const [open, setOpen] = useState(withinSection);

  // Auto-expand when navigation lands inside this section, adjusted during
  // render (React's documented pattern for this) rather than in an effect
  // -- avoids an extra post-commit render pass just to flip a boolean.
  const [trackedWithinSection, setTrackedWithinSection] = useState(withinSection);
  if (withinSection !== trackedWithinSection) {
    setTrackedWithinSection(withinSection);
    if (withinSection) setOpen(true);
  }

  const active = pathname === listHref;

  return (
    <div className="flex flex-col gap-1">
      <div className={cn("flex items-center rounded-lg pr-1", rowClass(active))}>
        <Link
          href={listHref}
          aria-current={active ? "page" : undefined}
          className="flex flex-1 items-center gap-3 px-3 py-2 text-sm"
        >
          <Icon className="size-4 shrink-0" />
          {title}
        </Link>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          aria-expanded={open}
          className="rounded-md p-1.5 opacity-70 hover:opacity-100"
        >
          <ChevronDownIcon
            className={cn("size-3.5 transition-transform", !open && "-rotate-90")}
          />
        </button>
      </div>

      {open &&
        (items.length === 0 ? (
          <p className="px-2 py-1 pl-9 text-sm text-sidebar-foreground/50">{emptyLabel}</p>
        ) : (
          <div className="flex flex-col gap-0.5 pl-6">
            {items.map((item) => {
              const itemActive = pathname === `${basePath}/${item.id}`;
              return (
                <Link
                  key={item.id}
                  href={`${basePath}/${item.id}`}
                  aria-current={itemActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm",
                    rowClass(itemActive),
                  )}
                >
                  {/* Leading marker anchors each row so the list reads as
                      rows, not floating text. */}
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      itemActive ? "bg-sidebar-primary-foreground" : "bg-primary/60",
                    )}
                  />
                  <span className="truncate">{item.name}</span>
                </Link>
              );
            })}
          </div>
        ))}
    </div>
  );
}
