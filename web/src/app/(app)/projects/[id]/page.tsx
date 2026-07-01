import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { DocumentsTable } from "./documents-table";
import { NewEstimateForm } from "./new-estimate-form";
import { UploadForm } from "./upload-form";

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

  const { data: documents } = await supabase
    .from("documents")
    .select("id, storage_path, status, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  const documentIds = (documents ?? []).map((d) => d.id);
  const { data: extractionResults } =
    documentIds.length > 0
      ? await supabase.from("extraction_results").select("document_id").in("document_id", documentIds)
      : { data: [] };
  const readyForReview = (extractionResults ?? []).map((r) => r.document_id);

  const { data: estimates } = await supabase
    .from("estimates")
    .select("id, name, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <p className="text-muted-foreground">
          Upload purchasing documents for this project.
        </p>
      </div>

      <UploadForm projectId={project.id} />

      {documents && documents.length > 0 ? (
        <DocumentsTable projectId={id} documents={documents} readyForReview={readyForReview} />
      ) : (
        <p className="text-muted-foreground">No documents uploaded yet.</p>
      )}

      <div className="flex flex-col gap-3 border-t pt-6">
        <h2 className="text-lg font-semibold">Estimates</h2>
        <NewEstimateForm projectId={project.id} />
        {estimates && estimates.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {estimates.map((estimate) => (
              <li key={estimate.id}>
                <Link
                  href={`/projects/${project.id}/estimates/${estimate.id}`}
                  className="block rounded-md border px-4 py-3 hover:bg-accent"
                >
                  {estimate.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No estimates yet.</p>
        )}
      </div>
    </div>
  );
}
