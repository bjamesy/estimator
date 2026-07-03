import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

// The sidebar owns navigation to Search/Projects/Estimates, so the home page
// doesn't restate it as action cards -- it shows what the nav can't: recent
// activity to jump back into.
export default async function HomePage() {
  const supabase = await createClient();

  // Recent items give returning users a jump-off point instead of a wall of
  // actions. Company scoping is enforced by RLS, so no explicit filter here.
  const [{ data: projects }, { data: estimates }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("estimates")
      .select("id, name, projects(name)")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Estimator</h1>
        <p className="text-muted-foreground">
          Your company&apos;s purchasing history, turned into faster estimates.
        </p>
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        <RecentSection
          title="Recent projects"
          viewAllHref="/projects"
          emptyLabel="No projects yet."
          items={(projects ?? []).map((p) => ({
            href: `/projects/${p.id}`,
            primary: p.name,
          }))}
        />
        <RecentSection
          title="Recent estimates"
          viewAllHref="/estimates"
          emptyLabel="No estimates yet."
          items={(estimates ?? []).map((e) => ({
            href: `/estimates/${e.id}`,
            primary: e.name,
            secondary: (e.projects as unknown as { name: string } | null)?.name,
          }))}
        />
      </div>
    </div>
  );
}

function RecentSection({
  title,
  viewAllHref,
  emptyLabel,
  items,
}: {
  title: string;
  viewAllHref: string;
  emptyLabel: string;
  items: { href: string; primary: string; secondary?: string }[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Link href={viewAllHref} className="text-sm text-muted-foreground hover:text-foreground">
          View all
        </Link>
      </div>
      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex items-center justify-between rounded-md border px-4 py-3 hover:bg-accent"
              >
                <span>{item.primary}</span>
                {item.secondary && (
                  <span className="text-sm text-muted-foreground">{item.secondary}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{emptyLabel}</p>
      )}
    </div>
  );
}
