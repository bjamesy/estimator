import { notFound, redirect } from "next/navigation";

import {
  DocumentStatusIndicator,
  DocumentStatusMessage,
  LineItemsTable,
} from "@/components/document-review";
import { documentFileName } from "@/lib/documents";
import { extractionPayloadSchema } from "@/lib/extraction-payload";
import { createClient } from "@/lib/supabase/server";

import { InboxConfirmForm } from "./inbox-confirm-form";

export default async function InboxDocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const supabase = await createClient();

  const { data: document } = await supabase
    .from("documents")
    .select("id, project_id, status, storage_path, rejection_reason")
    .eq("id", documentId)
    .single();

  if (!document) {
    notFound();
  }

  // Confirming backfills project_id (see confirmDocument) -- once that's
  // happened this document belongs under its project like any other, not
  // here.
  if (document.project_id !== null) {
    redirect(`/projects/${document.project_id}/documents/${document.id}`);
  }

  const { data: extractionResult } = await supabase
    .from("extraction_results")
    .select("payload")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let latestFailure: { stage: string; error_message: string | null } | null = null;
  if (document.status === "failed") {
    const { data: failedEvent } = await supabase
      .from("document_processing_events")
      .select("stage, error_message")
      .eq("document_id", documentId)
      .eq("status", "failed")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestFailure = failedEvent;
  }

  const parsed = extractionResult
    ? extractionPayloadSchema.safeParse(extractionResult.payload)
    : null;

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold">
            {parsed?.success ? parsed.data.supplier_name : documentFileName(document.storage_path)}
          </h1>
          <DocumentStatusIndicator status={document.status} />
        </div>
        {parsed?.success && (
          <p className="truncate text-sm text-muted-foreground">
            {parsed.data.invoice_date ?? "no date"} ·{" "}
            {parsed.data.total != null ? `$${parsed.data.total.toFixed(2)}` : "no total"}
          </p>
        )}
      </div>

      <DocumentStatusMessage
        status={document.status}
        rejectionReason={document.rejection_reason}
        latestFailure={latestFailure}
        hasExtractionResult={Boolean(extractionResult)}
        extractionParsedOk={parsed?.success ?? false}
      />

      {parsed?.success && (
        <>
          <LineItemsTable lineItems={parsed.data.line_items} />
          {document.status === "pending" && (
            <InboxConfirmForm documentId={document.id} projects={projects ?? []} />
          )}
        </>
      )}
    </div>
  );
}
