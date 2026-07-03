import { logout } from "@/app/actions/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

import { MainNav } from "./main-nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh">
      {/* Stacks into two rows on mobile (nav, then account controls) so the
          links + toggle + Log out don't overflow a phone width; a single
          row from sm up. The "Home" link is hidden on mobile since the
          Estimator logo already links home. */}
      <header className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
        <MainNav />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <form action={logout}>
            <Button type="submit" variant="ghost" size="sm">
              Log out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
