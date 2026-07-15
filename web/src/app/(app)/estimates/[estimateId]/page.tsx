import { FolderIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { type RawVersionStatus, VERSION_STATUS_LABELS } from "@/lib/estimate-status";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { type BuilderLine, EstimateBuilder } from "./estimate-builder";
import { RemovedLines } from "./removed-lines";
import { SnapshotVersionForm } from "./snapshot-version-form";

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
    .select(
      "id, description, quantity, unit_price, markup_percent, total, deleted_at, vendor_product_url, price_verified_at",
    )
    .eq("estimate_id", estimateId)
    .order("created_at", { ascending: true });

  // Tombstoned lines (deleted_at set) are retained and restorable but
  // excluded from the total and any export -- only active lines count.
  const lines = (allLines ?? []).filter((l) => l.deleted_at === null);
  const removedLines = (allLines ?? []).filter((l) => l.deleted_at !== null);

  const grandTotal = lines.reduce((sum, l) => sum + l.total, 0);

  // Latest vendor price check per active line (append-only history --
  // newest row wins). See docs/v2/plans/05-vendor-price-check-plan.md.
  const lineIds = lines.map((l) => l.id);
  const { data: checksData } =
    lineIds.length > 0
      ? await supabase
          .from("vendor_price_checks")
          .select("estimate_line_id, outcome, fetched_price, estimate_price, checked_at")
          .in("estimate_line_id", lineIds)
          .order("checked_at", { ascending: false })
      : { data: [] };
  const latestCheckByLine = new Map<
    string,
    { outcome: string; fetched_price: number | null; estimate_price: number; checked_at: string }
  >();
  for (const check of checksData ?? []) {
    if (!latestCheckByLine.has(check.estimate_line_id)) {
      latestCheckByLine.set(check.estimate_line_id, check);
    }
  }

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

  // For the builder panel's "Import from project" tool -- any company
  // project, not just the one (if any) this estimate is already linked to.
  const { data: projectsData } = await supabase
    .from("projects")
    .select("id, name")
    .order("name", { ascending: true });

  const builderLines: BuilderLine[] = lines.map((line) => ({
    id: line.id,
    description: line.description,
    quantity: line.quantity,
    unit_price: line.unit_price,
    markup_percent: line.markup_percent,
    total: line.total,
    vendor_product_url: line.vendor_product_url,
    price_verified_at: line.price_verified_at,
    latestPriceCheck: latestCheckByLine.get(line.id) ?? null,
  }));

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
            Project: {projectName}
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

      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Lines</h2>

        <EstimateBuilder
          estimateId={estimateId}
          lines={builderLines}
          grandTotal={grandTotal}
          projects={projectsData ?? []}
        />

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
                    {VERSION_STATUS_LABELS[v.status as RawVersionStatus] ?? v.status}
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
    </div>
  );
}
