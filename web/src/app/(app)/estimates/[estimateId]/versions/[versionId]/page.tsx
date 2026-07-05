import { ArrowLeftIcon, TriangleAlertIcon } from "lucide-react";
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
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

// Human labels + styling per change_kind. Removed rows are shown struck
// through and are excluded from this version's total (see
// 0016_estimate_versions.sql).
const CHANGE_BADGES: Record<string, { label: string; className: string } | null> = {
  unchanged: null,
  added: { label: "Added", className: "border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  modified: { label: "Changed", className: "border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  removed: { label: "Removed", className: "border-transparent bg-muted text-muted-foreground" },
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_contractor_signature: "Awaiting your signature",
  pending_client_signature: "Awaiting client signature",
  executed: "Executed",
  superseded: "Superseded",
};

export default async function EstimateVersionPage({
  params,
}: {
  params: Promise<{ estimateId: string; versionId: string }>;
}) {
  const { estimateId, versionId } = await params;
  const supabase = await createClient();

  const { data: version } = await supabase
    .from("estimate_versions")
    .select(
      "id, version_number, status, total, pct_change_from_root, created_at, estimates(name)",
    )
    .eq("id", versionId)
    .eq("estimate_id", estimateId)
    .single();

  if (!version) {
    notFound();
  }

  const estimateName =
    (version.estimates as unknown as { name: string } | null)?.name ?? "Estimate";

  const { data: linesData } = await supabase
    .from("estimate_version_lines")
    .select("id, description, quantity, unit_price, markup_percent, total, change_kind")
    .eq("estimate_version_id", versionId)
    .order("created_at", { ascending: true });
  const lines = linesData ?? [];

  // The original (version 1) total -- what the client first agreed to,
  // and what Ontario CPA's 10% rule measures against.
  const isRoot = version.version_number === 1;
  let rootTotal: number | null = null;
  if (!isRoot) {
    const { data: root } = await supabase
      .from("estimate_versions")
      .select("total")
      .eq("estimate_id", estimateId)
      .eq("version_number", 1)
      .single();
    rootTotal = root?.total ?? null;
  }

  const pct = version.pct_change_from_root;
  const overCpaThreshold = pct !== null && pct >= 10;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/estimates/${estimateId}`}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          {estimateName}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {estimateName} — Version {version.version_number}
          </h1>
          <Badge variant="outline">{STATUS_LABELS[version.status] ?? version.status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Snapshotted {new Date(version.created_at).toLocaleDateString()}. Versions are
          read-only — edit the estimate and snapshot again to make changes.
        </p>
      </div>

      {overCpaThreshold && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <TriangleAlertIcon className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="text-sm">
            <p className="font-semibold text-amber-800 dark:text-amber-300">
              {pct.toFixed(1)}% over the original estimate
            </p>
            <p className="text-amber-800/90 dark:text-amber-300/90">
              Ontario&apos;s Consumer Protection Act requires documented client consent for
              cost increases of 10% or more over the original estimate. Get this change
              order signed before proceeding with the work.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        {!isRoot && rootTotal !== null && (
          <span className="text-muted-foreground">
            Original estimate (v1): <span className="font-medium text-foreground">${rootTotal.toFixed(2)}</span>
          </span>
        )}
        <span className="text-muted-foreground">
          This version: <span className="font-medium text-foreground">${version.total.toFixed(2)}</span>
        </span>
        {pct !== null && (
          <span className={cn("font-medium", overCpaThreshold ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
            {pct >= 0 ? "+" : ""}
            {pct.toFixed(1)}% vs. original
          </span>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Unit price</TableHead>
            <TableHead className="text-right">Markup %</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => {
            const removed = line.change_kind === "removed";
            const badge = CHANGE_BADGES[line.change_kind];
            return (
              <TableRow
                key={line.id}
                className={cn(removed && "text-muted-foreground line-through opacity-70")}
              >
                <TableCell>{line.description}</TableCell>
                <TableCell className="text-right">{line.quantity}</TableCell>
                <TableCell className="text-right">${line.unit_price.toFixed(2)}</TableCell>
                <TableCell className="text-right">{line.markup_percent}%</TableCell>
                <TableCell className="text-right">${line.total.toFixed(2)}</TableCell>
                <TableCell>
                  {badge && <Badge className={badge.className}>{badge.label}</Badge>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="flex flex-col items-end gap-1">
        <p className="text-right text-sm font-medium">
          Version total: ${version.total.toFixed(2)}
        </p>
        {lines.some((l) => l.change_kind === "removed") && (
          <p className="text-right text-xs text-muted-foreground">
            Removed lines are shown struck through and are not counted in this
            version&apos;s total.
          </p>
        )}
      </div>

      {/* Signature blocks land here in Phase 3 (contractor first, then a
          tokenized client-signing link) -- see
          docs/v2/plans/01-change-orders-plan.md -> Phase 3. */}
    </div>
  );
}
