import Link from "next/link";
import { notFound } from "next/navigation";

import {
  DocumentStatusIndicator,
  DocumentStatusMessage,
  LineItemsTable,
} from "@/components/document-review";
import { documentFileName } from "@/lib/documents";
import { extractionPayloadSchema } from "@/lib/extraction-payload";
import { createClient } from "@/lib/supabase/server";

import { ConfirmButton } from "./confirm-button";
import { MaterialMatches } from "./material-matches";

export default async function DocumentReviewPage({
  params,
}: {
  params: Promise<{ id: string; documentId: string }>;
}) {
  const { id: projectId, documentId } = await params;
  const supabase = await createClient();

  const { data: document } = await supabase
    .from("documents")
    .select("id, project_id, status, storage_path, rejection_reason")
    .eq("id", documentId)
    .single();

  if (!document || document.project_id !== projectId) {
    notFound();
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

  let lineItems: { id: string; description: string }[] = [];
  let initialMatches: { id: string; line_item_id: string; status: string; material_name: string }[] = [];
  if (document.status === "confirmed") {
    const { data: invoice } = await supabase
      .from("invoices")
      .select("id")
      .eq("document_id", documentId)
      .single();

    if (invoice) {
      const { data: items } = await supabase
        .from("line_items")
        .select("id, description")
        .eq("invoice_id", invoice.id);
      lineItems = items ?? [];

      if (lineItems.length > 0) {
        const { data: matches } = await supabase
          .from("material_matches")
          .select("id, line_item_id, status, material_catalog(name)")
          .in(
            "line_item_id",
            lineItems.map((li) => li.id),
          );
        initialMatches = (matches ?? []).map((m) => ({
          id: m.id,
          line_item_id: m.line_item_id,
          status: m.status,
          material_name: (m.material_catalog as unknown as { name: string } | null)?.name ?? "—",
        }));
      }
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={`/projects/${projectId}`}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          &larr; Back to project
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* Lead with the supplier (meaningful) once extracted; the raw
              filename is a device name like a UUID, so it moves to a muted
              subline. */}
          <h1 className="text-2xl font-semibold">
            {parsed?.success ? parsed.data.supplier_name : documentFileName(document.storage_path)}
          </h1>
          <DocumentStatusIndicator status={document.status} />
        </div>
        {parsed?.success && (
          <p className="truncate text-sm text-muted-foreground">
            {parsed.data.invoice_date ?? "no date"} ·{" "}
            {parsed.data.total != null ? `$${parsed.data.total.toFixed(2)}` : "no total"} ·{" "}
            <span className="text-muted-foreground/70">
              {documentFileName(document.storage_path)}
            </span>
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
            <ConfirmButton documentId={document.id} projectId={projectId} />
          )}
          {document.status === "confirmed" && (
            <>
              <p className="text-sm text-muted-foreground">
                Confirmed -- promoted into the searchable historical record.
              </p>
              {lineItems.length > 0 && (
                <MaterialMatches
                  projectId={projectId}
                  documentId={document.id}
                  lineItems={lineItems}
                  initialMatches={initialMatches}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
