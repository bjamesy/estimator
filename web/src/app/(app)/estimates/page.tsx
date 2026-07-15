import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  deriveEstimateStatusBucket,
  type RawVersionStatus,
  VERSION_STATUS_LABELS,
} from "@/lib/estimate-status";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { EstimatesList, type EstimateRow } from "./estimates-list";

export default async function EstimatesPage() {
  const supabase = await createClient();

  const { data: estimatesData } = await supabase
    .from("estimates")
    .select("id, name, created_at, project_id, projects(name)")
    .order("created_at", { ascending: false });
  const estimates = estimatesData ?? [];

  const estimateIds = estimates.map((e) => e.id);
  const { data: versionsData } =
    estimateIds.length > 0
      ? await supabase
          .from("estimate_versions")
          .select("estimate_id, version_number, status")
          .in("estimate_id", estimateIds)
          .order("version_number", { ascending: false })
      : { data: [] };

  // Latest version per estimate -- first row wins per estimate_id since the
  // query above is ordered version_number desc.
  const latestVersionByEstimate = new Map<string, { status: string }>();
  for (const v of versionsData ?? []) {
    if (!latestVersionByEstimate.has(v.estimate_id)) {
      latestVersionByEstimate.set(v.estimate_id, v);
    }
  }

  const rows: EstimateRow[] = estimates.map((e) => {
    const latestStatus = latestVersionByEstimate.get(e.id)?.status ?? null;
    const labelKey = (latestStatus ?? "draft") as RawVersionStatus;
    return {
      id: e.id,
      name: e.name,
      projectName: (e.projects as unknown as { name: string } | null)?.name ?? null,
      createdAt: e.created_at,
      bucket: deriveEstimateStatusBucket(latestStatus),
      statusLabel: VERSION_STATUS_LABELS[labelKey] ?? latestStatus ?? "Draft",
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Estimates</h1>
          <p className="text-muted-foreground">
            Every estimate across your company, from first draft to signed.
          </p>
        </div>
        <Link href="/estimates/new" className={cn(buttonVariants())}>
          New estimate
        </Link>
      </div>

      <EstimatesList estimates={rows} />
    </div>
  );
}
