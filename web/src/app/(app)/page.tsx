import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
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
          empty={{
            title: "No projects yet",
            description:
              "A project holds one job's purchasing history. Create one, then upload its receipts and invoices.",
            action: { href: "/projects", label: "New project" },
          }}
          items={(projects ?? []).map((p) => ({
            href: `/projects/${p.id}`,
            primary: p.name,
          }))}
        />
        <RecentSection
          title="Recent estimates"
          viewAllHref="/estimates"
          empty={{
            title: "No estimates yet",
            description:
              "Estimates draw on your whole purchasing history to price new work. Build one once you've uploaded some documents.",
            action: { href: "/estimates", label: "New estimate" },
          }}
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
  empty,
  items,
}: {
  title: string;
  viewAllHref: string;
  empty: { title: string; description: string; action: { href: string; label: string } };
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
        <EmptyState
          title={empty.title}
          description={empty.description}
          action={empty.action}
        />
      )}
    </div>
  );
}
