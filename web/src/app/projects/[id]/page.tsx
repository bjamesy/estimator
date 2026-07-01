import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { DocumentsTable } from "./documents-table";
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
        <DocumentsTable documents={documents} />
      ) : (
        <p className="text-muted-foreground">No documents uploaded yet.</p>
      )}
    </div>
  );
}
