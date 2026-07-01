import Link from "next/link";

import { logout } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <Link href="/projects" className="font-semibold">
          Estimator
        </Link>
        <form action={logout}>
          <Button type="submit" variant="ghost" size="sm">
            Log out
          </Button>
        </form>
      </header>
      <main className="mx-auto max-w-3xl p-6">{children}</main>
    </div>
  );
}
