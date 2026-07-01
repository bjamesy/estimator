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

  const parsed = extractionResult
    ? extractionPayloadSchema.safeParse(extractionResult.payload)
    : null;

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

      {!extractionResult && (
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
            <p className="text-sm text-muted-foreground">
              Confirmed -- promoted into the searchable historical record.
            </p>
          )}
        </>
      )}
    </div>
  );
}
