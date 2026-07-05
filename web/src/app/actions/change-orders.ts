"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { tryGetCurrentCompanyId } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";

const POSTGRES_UNIQUE_VIOLATION = "23505";

// Numeric fields round-trip Postgres numeric -> JSON number; compare with
// the same tolerance the estimate-seeding price comparison uses rather
// than trusting float equality.
const NUMERIC_EPSILON = 0.0001;

type DraftLine = {
  id: string;
  source_line_item_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  markup_percent: number;
  total: number;
};

type VersionLine = {
  source_estimate_line_id: string | null;
  source_line_item_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  markup_percent: number;
  total: number;
  change_kind: string;
};

function linesEqual(draft: DraftLine, parent: VersionLine): boolean {
  return (
    draft.description === parent.description &&
    Math.abs(draft.quantity - parent.quantity) < NUMERIC_EPSILON &&
    Math.abs(draft.unit_price - parent.unit_price) < NUMERIC_EPSILON &&
    Math.abs(draft.markup_percent - parent.markup_percent) < NUMERIC_EPSILON
  );
}

// Same rationale as assertEstimateOwnership in estimates.ts (module-private
// there): estimate_versions' RLS policy only validates the new row's own
// company_id, not the estimate_id it references, and this is a plain
// exported Server Action invocable directly.
async function assertEstimateOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  estimateId: string,
  companyId: string,
): Promise<string | null> {
  const { data: estimate } = await supabase
    .from("estimates")
    .select("id")
    .eq("id", estimateId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!estimate) {
    return "Estimate not found.";
  }
  return null;
}

// Freezes the estimate's current active draft lines into a new immutable
// EstimateVersion (see 0016_estimate_versions.sql and
// docs/v2/plans/01-change-orders-plan.md -> Phase 1).
//
// - Each frozen line gets a change_kind computed against the previous
//   version, keyed on which draft line it came from
//   (source_estimate_line_id) -- not on description matching. Lines
//   present in the parent but gone from the draft are carried into the
//   new version as 'removed' rows (self-contained change order), excluded
//   from its total.
// - The root version (version 1) is the baseline: every line 'unchanged',
//   pct_change_from_root null.
// - A snapshot with no changes vs. the latest version is refused.
// - A previous version that never reached 'executed' is marked
//   'superseded'; executed versions are never touched -- they happened.
//
// Redirects to the new version's page on success; returns { error } on
// failure (bind as a form action with useActionState).
export async function snapshotEstimateVersion(
  estimateId: string,
  _prevState: unknown,
  _formData: FormData,
): Promise<{ error: string }> {
  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();

  const ownershipError = await assertEstimateOwnership(supabase, estimateId, companyId);
  if (ownershipError) {
    return { error: ownershipError };
  }

  // Active draft lines only -- tombstoned (deleted_at set) lines are
  // "removed from the draft" and will diff as 'removed' if the parent
  // version had them.
  const { data: draftData } = await supabase
    .from("estimate_lines")
    .select("id, source_line_item_id, description, quantity, unit_price, markup_percent, total")
    .eq("estimate_id", estimateId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  const draftLines: DraftLine[] = draftData ?? [];

  const { data: latestVersion } = await supabase
    .from("estimate_versions")
    .select("id, version_number, status, total")
    .eq("estimate_id", estimateId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestVersion && draftLines.length === 0) {
    return { error: "Nothing to snapshot — the estimate has no lines." };
  }

  // The parent's baseline is its non-removed lines: a 'removed' row in
  // the parent recorded a removal that already happened at that version,
  // not content this snapshot should diff against.
  let parentLines: VersionLine[] = [];
  if (latestVersion) {
    const { data: parentData } = await supabase
      .from("estimate_version_lines")
      .select(
        "source_estimate_line_id, source_line_item_id, description, quantity, unit_price, markup_percent, total, change_kind",
      )
      .eq("estimate_version_id", latestVersion.id)
      .neq("change_kind", "removed")
      .order("created_at", { ascending: true });
    parentLines = parentData ?? [];
  }

  const parentBySource = new Map(
    parentLines
      .filter((l) => l.source_estimate_line_id !== null)
      .map((l) => [l.source_estimate_line_id as string, l]),
  );

  const newLines: (Omit<VersionLine, "change_kind"> & {
    change_kind: "unchanged" | "added" | "modified" | "removed";
  })[] = [];

  for (const draft of draftLines) {
    const parent = latestVersion ? parentBySource.get(draft.id) : undefined;
    const change_kind = !latestVersion
      ? "unchanged" // root version is the baseline
      : !parent
        ? "added"
        : linesEqual(draft, parent)
          ? "unchanged"
          : "modified";
    newLines.push({
      source_estimate_line_id: draft.id,
      source_line_item_id: draft.source_line_item_id,
      description: draft.description,
      quantity: draft.quantity,
      unit_price: draft.unit_price,
      markup_percent: draft.markup_percent,
      total: draft.total,
      change_kind,
    });
  }

  // Parent lines with no surviving draft line become 'removed' rows,
  // carrying the parent's frozen values.
  const draftIds = new Set(draftLines.map((l) => l.id));
  for (const parent of parentLines) {
    const stillPresent =
      parent.source_estimate_line_id !== null && draftIds.has(parent.source_estimate_line_id);
    if (!stillPresent) {
      newLines.push({
        source_estimate_line_id: parent.source_estimate_line_id,
        source_line_item_id: parent.source_line_item_id,
        description: parent.description,
        quantity: parent.quantity,
        unit_price: parent.unit_price,
        markup_percent: parent.markup_percent,
        total: parent.total,
        change_kind: "removed",
      });
    }
  }

  if (
    latestVersion &&
    newLines.every((l) => l.change_kind === "unchanged")
  ) {
    return { error: `No changes since version ${latestVersion.version_number}.` };
  }

  const total = newLines
    .filter((l) => l.change_kind !== "removed")
    .reduce((sum, l) => sum + l.total, 0);

  // % change is always measured against the root (version 1) -- that is
  // the estimate the client originally agreed to, which is what Ontario
  // CPA's 10% rule is relative to. Not the parent version.
  let pctChangeFromRoot: number | null = null;
  if (latestVersion) {
    const { data: rootVersion } = await supabase
      .from("estimate_versions")
      .select("total")
      .eq("estimate_id", estimateId)
      .eq("version_number", 1)
      .single();
    if (rootVersion && rootVersion.total > 0) {
      pctChangeFromRoot = ((total - rootVersion.total) / rootVersion.total) * 100;
    }
  }

  const { data: version, error: versionError } = await supabase
    .from("estimate_versions")
    .insert({
      estimate_id: estimateId,
      company_id: companyId,
      parent_version_id: latestVersion?.id ?? null,
      version_number: (latestVersion?.version_number ?? 0) + 1,
      status: "draft",
      total,
      pct_change_from_root: pctChangeFromRoot,
    })
    .select("id")
    .single();

  if (versionError?.code === POSTGRES_UNIQUE_VIOLATION) {
    return { error: "A snapshot was just taken by another request — refresh and try again." };
  }
  if (versionError) {
    return { error: versionError.message };
  }

  const { error: linesError } = await supabase.from("estimate_version_lines").insert(
    newLines.map((l) => ({
      estimate_version_id: version.id,
      company_id: companyId,
      ...l,
    })),
  );

  if (linesError) {
    // A version row without its lines is a corrupt artifact -- best-effort
    // roll it back (it has no children yet, so RESTRICT doesn't block).
    await supabase.from("estimate_versions").delete().eq("id", version.id);
    return { error: `Failed to snapshot lines: ${linesError.message}` };
  }

  // Supersede the previous version if it never reached executed.
  if (latestVersion && latestVersion.status !== "executed") {
    await supabase
      .from("estimate_versions")
      .update({ status: "superseded" })
      .eq("id", latestVersion.id);
  }

  revalidatePath(`/estimates/${estimateId}`);
  redirect(`/estimates/${estimateId}/versions/${version.id}`);
}
