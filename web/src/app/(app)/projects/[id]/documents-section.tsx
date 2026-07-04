import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/server";

import { DocumentsTable } from "./documents-table";
import { UploadForm } from "./upload-form";

// The Documents tab: upload plus the live-updating documents table. Kept as
// its own async server component so the project page's tab wrapper stays a
// thin composition and this section owns its own data fetch.
export async function DocumentsSection({ projectId }: { projectId: string }) {
  const supabase = await createClient();

  const { data: documents } = await supabase
    .from("documents")
    .select("id, storage_path, status, created_at, rejection_reason")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const documentIds = (documents ?? []).map((d) => d.id);
  const { data: extractionResults } =
    documentIds.length > 0
      ? await supabase.from("extraction_results").select("document_id").in("document_id", documentIds)
      : { data: [] };
  const readyForReview = (extractionResults ?? []).map((r) => r.document_id);

  return (
    <div className="flex flex-col gap-4">
      <UploadForm projectId={projectId} />
      {documents && documents.length > 0 ? (
        <DocumentsTable projectId={projectId} documents={documents} readyForReview={readyForReview} />
      ) : (
        <EmptyState
          title="No documents yet"
          description="Upload a receipt or invoice above. We'll extract its line items so they become searchable purchasing history."
        />
      )}
    </div>
  );
}
