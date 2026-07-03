import { createClient } from "@/lib/supabase/server";

import { NewEstimateForm } from "./new-estimate-form";

// The list of estimates lives in the sidebar now, so this page is just the
// create form. It still needs the projects list to seed from.
export default async function EstimatesPage() {
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .order("name", { ascending: true });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">New estimate</h1>
        <p className="text-muted-foreground">
          Draw on your company&apos;s full purchasing history to build a projection.
        </p>
      </div>

      <NewEstimateForm projects={projects ?? []} />
    </div>
  );
}
