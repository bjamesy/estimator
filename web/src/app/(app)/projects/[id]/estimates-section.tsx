import Link from "next/link";

import { CreateFromProjectForm } from "@/app/(app)/estimates/create-from-project-form";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/server";

// The Estimates tab: seed a new estimate from this project's purchases, and
// list the estimates already tied to it.
export async function EstimatesSection({ projectId }: { projectId: string }) {
  const supabase = await createClient();

  const { data: estimates } = await supabase
    .from("estimates")
    .select("id, name, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-3">
      <CreateFromProjectForm projectId={projectId} />
      {estimates && estimates.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {estimates.map((estimate) => (
            <li key={estimate.id}>
              <Link
                href={`/estimates/${estimate.id}`}
                className="block rounded-md border px-4 py-3 hover:bg-accent"
              >
                {estimate.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No estimates for this project yet"
          description="Seed an estimate from this project's purchases above, or build a company-wide one from the Estimates page."
        />
      )}
    </div>
  );
}
