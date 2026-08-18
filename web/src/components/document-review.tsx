import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ExtractionPayload } from "@/lib/extraction-payload";
import { cn } from "@/lib/utils";

// Shared between web/src/app/(app)/projects/[id]/documents/[documentId]/page.tsx
// (a document that already has a project) and
// web/src/app/(app)/inbox/[documentId]/page.tsx (an SMS-received document
// that doesn't yet) -- extraction rendering is identical regardless of
// which channel the document arrived through; only the surrounding
// header/confirm-action area differs per page.

const STATUS_META: Record<string, { dot: string; label: string }> = {
  pending: { dot: "bg-amber-500", label: "Pending review" },
  confirmed: { dot: "bg-emerald-500", label: "Confirmed" },
  failed: { dot: "bg-destructive", label: "Failed" },
  rejected: { dot: "bg-muted-foreground", label: "Rejected" },
};

export function DocumentStatusIndicator({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { dot: "bg-muted-foreground", label: status };
  return (
    <span className="inline-flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
      <span className={cn("size-2 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function DocumentStatusMessage({
  status,
  rejectionReason,
  latestFailure,
  hasExtractionResult,
  extractionParsedOk,
}: {
  status: string;
  rejectionReason: string | null;
  latestFailure: { stage: string; error_message: string | null } | null;
  hasExtractionResult: boolean;
  extractionParsedOk: boolean;
}) {
  if (status === "failed") {
    return (
      <p className="text-destructive">
        Processing failed{latestFailure ? ` at the "${latestFailure.stage}" stage` : ""}
        {latestFailure?.error_message ? `: ${latestFailure.error_message}` : "."} Re-upload the
        document to try again.
      </p>
    );
  }
  if (status === "rejected") {
    return (
      <p className="text-muted-foreground">
        This doesn&apos;t look like a purchase document
        {rejectionReason ? ` — ${rejectionReason}` : ""}. Nothing was added to your history. If
        this really is a receipt or invoice, re-upload a clearer copy.
      </p>
    );
  }
  if (!hasExtractionResult) {
    return (
      <p className="text-muted-foreground">
        Still processing -- no extracted data yet. Refresh in a moment.
      </p>
    );
  }
  if (hasExtractionResult && !extractionParsedOk) {
    return <p className="text-destructive">Extracted data is malformed and cannot be reviewed.</p>;
  }
  return null;
}

export function LineItemsTable({ lineItems }: { lineItems: ExtractionPayload["line_items"] }) {
  return (
    // min-width so the columns keep readable widths and the table's
    // overflow-x-auto scrolls (a sliding bar) on mobile instead of
    // squishing everything into the Description column.
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
        {lineItems.map((item, i) => (
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
  );
}
