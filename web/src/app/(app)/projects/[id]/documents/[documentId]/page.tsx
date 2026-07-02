import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
    .select("id, project_id, status, storage_path")
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
      <div>
        <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground underline">
          &larr; Back to project
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{document.storage_path.split("/").pop()}</h1>
          <Badge variant={document.status === "confirmed" ? "default" : "secondary"}>
            {document.status}
          </Badge>
        </div>
      </div>

      {document.status === "failed" && (
        <p className="text-destructive">
          Processing failed{latestFailure ? ` at the "${latestFailure.stage}" stage` : ""}
          {latestFailure?.error_message ? `: ${latestFailure.error_message}` : "."} Re-upload the
          document to try again.
        </p>
      )}

      {!extractionResult && document.status !== "failed" && (
        <p className="text-muted-foreground">
          Still processing -- no extracted data yet. Refresh in a moment.
        </p>
      )}

      {extractionResult && !parsed?.success && (
        <p className="text-destructive">Extracted data is malformed and cannot be reviewed.</p>
      )}

      {parsed?.success && (
        <>
          <p className="text-sm text-muted-foreground">
            {parsed.data.supplier_name} · {parsed.data.invoice_date ?? "no date"} ·{" "}
            {parsed.data.total != null ? `$${parsed.data.total.toFixed(2)}` : "no total"}
          </p>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit price</TableHead>
                <TableHead>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parsed.data.line_items.map((item, i) => (
                <TableRow key={i}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell>{item.sku ?? "—"}</TableCell>
                  <TableCell>{item.quantity}</TableCell>
                  <TableCell>${item.unit_price.toFixed(2)}</TableCell>
                  <TableCell>${item.total.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

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
