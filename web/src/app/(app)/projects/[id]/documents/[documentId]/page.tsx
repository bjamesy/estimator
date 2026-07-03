import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { documentFileName } from "@/lib/documents";
import { extractionPayloadSchema } from "@/lib/extraction-payload";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { ConfirmButton } from "./confirm-button";
import { MaterialMatches } from "./material-matches";

// Subtle dot + label status, matching the documents list (replaces the loud
// filled badge).
const STATUS_META: Record<string, { dot: string; label: string }> = {
  pending: { dot: "bg-amber-500", label: "Pending review" },
  confirmed: { dot: "bg-emerald-500", label: "Confirmed" },
  failed: { dot: "bg-destructive", label: "Failed" },
  rejected: { dot: "bg-muted-foreground", label: "Rejected" },
};

function StatusIndicator({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { dot: "bg-muted-foreground", label: status };
  return (
    <span className="inline-flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
      <span className={cn("size-2 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

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
          <StatusIndicator status={document.status} />
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

      {document.status === "failed" && (
        <p className="text-destructive">
          Processing failed{latestFailure ? ` at the "${latestFailure.stage}" stage` : ""}
          {latestFailure?.error_message ? `: ${latestFailure.error_message}` : "."} Re-upload the
          document to try again.
        </p>
      )}

      {document.status === "rejected" && (
        <p className="text-muted-foreground">
          This doesn&apos;t look like a purchase document
          {document.rejection_reason ? ` — ${document.rejection_reason}` : ""}. Nothing was added to
          your history. If this really is a receipt or invoice, re-upload a clearer copy.
        </p>
      )}

      {!extractionResult && document.status !== "failed" && document.status !== "rejected" && (
        <p className="text-muted-foreground">
          Still processing -- no extracted data yet. Refresh in a moment.
        </p>
      )}

      {extractionResult && !parsed?.success && (
        <p className="text-destructive">Extracted data is malformed and cannot be reviewed.</p>
      )}

      {parsed?.success && (
        <>
          {/* min-width so the columns keep readable widths and the table's
              overflow-x-auto scrolls (a sliding bar) on mobile instead of
              squishing everything into the Description column. */}
          <Table className="min-w-[640px]">
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
