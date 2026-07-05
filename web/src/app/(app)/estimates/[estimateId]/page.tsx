import { FolderIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { addBlankEstimateLine } from "@/app/actions/estimates";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { EstimateLineRow } from "./estimate-line-row";
import { HistoricalSearch } from "./historical-search";
import { RemovedLines } from "./removed-lines";
import { SnapshotVersionForm } from "./snapshot-version-form";

const VERSION_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_contractor_signature: "Awaiting your signature",
  pending_client_signature: "Awaiting client signature",
  executed: "Executed",
  superseded: "Superseded",
};

export default async function EstimatePage({
  params,
}: {
  params: Promise<{ estimateId: string }>;
}) {
  const { estimateId } = await params;
  const supabase = await createClient();

  const { data: estimate } = await supabase
    .from("estimates")
    .select("id, project_id, name, projects(name)")
    .eq("id", estimateId)
    .single();

  if (!estimate) {
    notFound();
  }

  const projectName = (estimate.projects as unknown as { name: string } | null)?.name;

  const { data: allLines } = await supabase
    .from("estimate_lines")
    .select("id, description, quantity, unit_price, markup_percent, total, deleted_at")
    .eq("estimate_id", estimateId)
    .order("created_at", { ascending: true });

  // Tombstoned lines (deleted_at set) are retained and restorable but
  // excluded from the total and any export -- only active lines count.
  const lines = (allLines ?? []).filter((l) => l.deleted_at === null);
  const removedLines = (allLines ?? []).filter((l) => l.deleted_at !== null);

  const grandTotal = lines.reduce((sum, l) => sum + l.total, 0);

  const { data: versionsData } = await supabase
    .from("estimate_versions")
    .select("id, version_number, status, total, pct_change_from_root, created_at")
    .eq("estimate_id", estimateId)
    .order("version_number", { ascending: false });
  const versions = versionsData ?? [];

  // Live CPA check: how far the *current draft* has moved from the original
  // (version 1) total. Ontario's Consumer Protection Act requires documented
  // client consent for increases of 10% or more, so warn while editing --
  // before the snapshot -- not only on the frozen version.
  const rootVersion = versions.find((v) => v.version_number === 1);
  const draftPctFromRoot =
    rootVersion && rootVersion.total > 0
      ? ((grandTotal - rootVersion.total) / rootVersion.total) * 100
      : null;
  const draftOverCpaThreshold = draftPctFromRoot !== null && draftPctFromRoot >= 10;

  const addBlankLine = addBlankEstimateLine.bind(null, estimateId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{estimate.name}</h1>
        {estimate.project_id && projectName && (
          <Link
            href={`/projects/${estimate.project_id}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <FolderIcon className="size-4" />
            {projectName}
          </Link>
        )}
      </div>

      {draftOverCpaThreshold && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <TriangleAlertIcon className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="text-sm">
            <p className="font-semibold text-amber-800 dark:text-amber-300">
              This draft is {draftPctFromRoot.toFixed(1)}% over the original estimate
            </p>
            <p className="text-amber-800/90 dark:text-amber-300/90">
              Ontario&apos;s Consumer Protection Act requires documented client consent for
              cost increases of 10% or more. Snapshot a new version below and get it signed
              as a change order before proceeding.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Lines</h2>
          <form action={addBlankLine}>
            <Button type="submit" size="sm" variant="outline">
              Add blank line
            </Button>
          </form>
        </div>

        {lines.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                {/* Header is one colSpan-6 cell wrapping the SAME
                    grid-cols-6 layout as each body row (EstimateLineRow),
                    so the labels line up with the input columns. Real <th>
                    cells wouldn't: every body row is a single colSpan-6 cell
                    with its own internal grid, so the table's auto column
                    widths never match. */}
                <TableRow>
                  <TableHead colSpan={6} className="p-0">
                    {/* min-w keeps the columns usable on mobile: the table's
                        overflow-x-auto container scrolls horizontally instead
                        of shrinking inputs to nothing. Must match the row
                        grid's min-w in estimate-line-row.tsx so header and
                        body stay aligned. */}
                    <div className="grid min-w-[640px] grid-cols-6 items-center gap-2 p-2 text-muted-foreground">
                      <span className="col-span-2">Description</span>
                      <span>Qty</span>
                      <span>Unit price</span>
                      <span>Markup %</span>
                      <span>Total</span>
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <EstimateLineRow
                    // Keying on total (which changes whenever any editable
                    // field does, via server-side recalculation) forces a
                    // clean remount instead of an in-place update -- the
                    // defaultValue-based inputs below need a remount to
                    // pick up fresh server data without React warning
                    // about changing an uncontrolled input's default value
                    // after the fact.
                    key={`${line.id}-${line.total}`}
                    line={line}
                    estimateId={estimateId}
                  />
                ))}
              </TableBody>
            </Table>
            <p className="text-right text-sm font-medium">
              Estimate total: ${grandTotal.toFixed(2)}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">No lines yet.</p>
        )}

        {removedLines.length > 0 && (
          <RemovedLines estimateId={estimateId} lines={removedLines} />
        )}
      </div>

      {/* Immutable version history -- the substrate for change orders.
          Snapshotting freezes the current draft lines; the frozen version
          diffs itself against its parent. See
          docs/v2/plans/01-change-orders-plan.md. */}
      <div className="flex flex-col gap-2 border-t pt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Versions</h2>
          <SnapshotVersionForm
            estimateId={estimateId}
            nextVersionNumber={(versions[0]?.version_number ?? 0) + 1}
          />
        </div>
        {versions.length > 0 ? (
          <ul className="flex flex-col divide-y">
            {versions.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/estimates/${estimateId}/versions/${v.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm hover:bg-muted/50"
                >
                  <span className="font-medium">Version {v.version_number}</span>
                  <Badge variant="outline">
                    {VERSION_STATUS_LABELS[v.status] ?? v.status}
                  </Badge>
                  <span className="text-muted-foreground">
                    {new Date(v.created_at).toLocaleDateString()}
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    {v.pct_change_from_root !== null && (
                      <span
                        className={
                          v.pct_change_from_root >= 10
                            ? "font-medium text-amber-700 dark:text-amber-400"
                            : "text-muted-foreground"
                        }
                      >
                        {v.pct_change_from_root >= 0 ? "+" : ""}
                        {v.pct_change_from_root.toFixed(1)}%
                      </span>
                    )}
                    <span className="font-medium">${v.total.toFixed(2)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No versions yet. Snapshot the estimate to freeze version 1 — the baseline any
            future change order is measured against.
          </p>
        )}
      </div>

      <div className="border-t pt-6">
        <HistoricalSearch estimateId={estimateId} />
      </div>
    </div>
  );
}
