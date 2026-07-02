import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

import { NewEstimateForm } from "./new-estimate-form";

export default async function EstimatesPage() {
  const supabase = await createClient();

  const { data: estimates } = await supabase
    .from("estimates")
    .select("id, name, created_at, projects(name)")
    .order("created_at", { ascending: false });

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .order("name", { ascending: true });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Estimates</h1>
        <p className="text-muted-foreground">
          Draw on your company&apos;s full purchasing history to build a projection.
        </p>
      </div>

      <NewEstimateForm projects={projects ?? []} />

      {estimates && estimates.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {estimates.map((estimate) => {
            const projectName = (estimate.projects as unknown as { name: string } | null)?.name;
            return (
              <li key={estimate.id}>
                <Link
                  href={`/estimates/${estimate.id}`}
                  className="flex items-center justify-between rounded-md border px-4 py-3 hover:bg-accent"
                >
                  <span>{estimate.name}</span>
                  {projectName && (
                    <span className="text-sm text-muted-foreground">{projectName}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground">No estimates yet.</p>
      )}
    </div>
  );
}
