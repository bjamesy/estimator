import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { DocumentsSection } from "./documents-section";
import { EstimatesSection } from "./estimates-section";
import { MaterialSummary } from "./material-summary";
import { ProjectTabs } from "./project-tabs";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", id)
    .single();

  if (!project) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <p className="text-muted-foreground">
          Documents, estimates, and material spend for this project.
        </p>
      </div>

      <ProjectTabs
        documents={<DocumentsSection projectId={id} />}
        estimates={<EstimatesSection projectId={id} />}
        materials={<MaterialSummary projectId={id} />}
      />
    </div>
  );
}
