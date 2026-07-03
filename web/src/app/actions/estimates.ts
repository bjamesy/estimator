"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { tryGetCurrentCompanyId } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";

const POSTGRES_UNIQUE_VIOLATION = "23505";

function computeTotal(quantity: number, unitPrice: number, markupPercent: number): number {
  return quantity * unitPrice * (1 + markupPercent / 100);
}

// Case-insensitive unique per project (standalone estimates form their
// own group within the company) -- see 0013_unique_names.sql.
function duplicateNameError(name: string, hasProject: boolean): string {
  return hasProject
    ? `An estimate named "${name}" already exists in this project.`
    : `A standalone estimate named "${name}" already exists.`;
}

// estimate_lines' RLS policy only validates the new row's own company_id
// column, not the estimate_id it references -- without this check, a
// caller could insert a row with company_id = their own company but
// estimate_id pointing at a different company's estimate (this function
// is a plain exported Server Action, invocable directly, not gated behind
// the specific UI form that normally supplies a same-company estimateId).
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

// The /estimates picker's create action. Selecting a project now seeds the
// new estimate from that project's purchase history -- the same path the
// project page uses (seedEstimateFromProject) -- rather than merely tagging
// it, so "reference a project" always means "built from this project's
// actuals". "No project" creates a blank, company-wide estimate built up
// via historical search. See docs/architecture.md -> Estimate-building data
// flow.
export async function createEstimate(_prevState: unknown, formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  if (!name) {
    return { error: "Estimate name is required." };
  }

  const rawProjectId = formData.get("project_id") as string | null;
  if (rawProjectId) {
    return seedEstimateFromProject(rawProjectId, name);
  }

  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("estimates")
    .insert({ project_id: null, company_id: companyId, name })
    .select("id")
    .single();

  if (error?.code === POSTGRES_UNIQUE_VIOLATION) {
    return { error: duplicateNameError(name, false) };
  }
  if (error) {
    return { error: error.message };
  }

  revalidatePath("/estimates");
  redirect(`/estimates/${data.id}`);
}

// Thin wrapper bound on the project page's "from this project" button.
// Both this and the /estimates picker (createEstimate, when a project is
// selected) funnel into seedEstimateFromProject so there is exactly one
// seeding path.
export async function createEstimateFromProject(
  projectId: string,
  _prevState: unknown,
  formData: FormData,
) {
  const name = (formData.get("name") as string)?.trim();
  if (!name) {
    return { error: "Estimate name is required." };
  }
  return seedEstimateFromProject(projectId, name);
}

// Bulk-seeds a new estimate from a project's own confirmed purchase
// history, instead of manually searching+adding one line at a time
// (addHistoricalLineToEstimate). For each canonical material used on
// the project (grouped via a "proposed" MaterialMatch -- a "flagged"
// match's grouping isn't trustworthy, so those are treated like an
// unmatched line item instead of aggregated), seeds up to two lines:
// the total quantity at the weighted-average price actually paid on
// this project, and -- only if it differs -- a second line at the same
// quantity but priced at the most recent company-wide purchase of that
// material (any project/supplier). Line items with no trustworthy
// match are seeded individually at their own price, with no comparison
// line (there's no canonical material to look one up by). The user
// reviews the result on the normal estimate page and deletes/edits
// whichever lines they don't want -- that review *is* the approval,
// there's no separate staging step or approved status. Redirects to the
// new estimate on success; returns { error } on failure.
async function seedEstimateFromProject(
  projectId: string,
  name: string,
): Promise<{ error: string }> {
  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!project) {
    return { error: "Project not found." };
  }

  const { data: invoices } = await supabase
    .from("invoices")
    .select("id")
    .eq("project_id", projectId);
  const invoiceIds = (invoices ?? []).map((i) => i.id);

  const { data: lineItemsData } =
    invoiceIds.length > 0
      ? await supabase
          .from("line_items")
          .select("id, description, quantity, unit_price")
          .in("invoice_id", invoiceIds)
      : { data: [] };
  const lineItems = lineItemsData ?? [];
  const lineItemIds = lineItems.map((li) => li.id);

  const { data: matchesData } =
    lineItemIds.length > 0
      ? await supabase
          .from("material_matches")
          .select("line_item_id, material_id, status, material_catalog(name)")
          .in("line_item_id", lineItemIds)
      : { data: [] };
  const matchByLineItem = new Map(
    (matchesData ?? []).map((m) => [
      m.line_item_id,
      {
        materialId: m.material_id as string,
        status: m.status as string,
        materialName: (m.material_catalog as unknown as { name: string } | null)?.name,
      },
    ]),
  );

  const matchedGroups = new Map<
    string,
    { name: string; totalQuantity: number; weightedPriceSum: number }
  >();
  const unmatchedItems: typeof lineItems = [];

  for (const item of lineItems) {
    const match = matchByLineItem.get(item.id);
    if (match && match.status === "proposed" && match.materialName) {
      const existing = matchedGroups.get(match.materialId);
      if (existing) {
        existing.totalQuantity += item.quantity;
        existing.weightedPriceSum += item.quantity * item.unit_price;
      } else {
        matchedGroups.set(match.materialId, {
          name: match.materialName,
          totalQuantity: item.quantity,
          weightedPriceSum: item.quantity * item.unit_price,
        });
      }
    } else {
      unmatchedItems.push(item);
    }
  }

  // Most recent company-wide purchase price per matched material,
  // regardless of which project/supplier -- one query covering every
  // material needed rather than one query per material.
  const materialIds = [...matchedGroups.keys()];
  const { data: purchasesData } =
    materialIds.length > 0
      ? await supabase
          .from("material_matches")
          .select("material_id, line_items(unit_price, invoices(invoice_date, created_at))")
          .in("material_id", materialIds)
      : { data: [] };

  const latestByMaterial = new Map<string, { price: number; sortKey: string }>();
  for (const purchase of purchasesData ?? []) {
    const li = purchase.line_items as unknown as {
      unit_price: number;
      invoices: { invoice_date: string | null; created_at: string } | null;
    } | null;
    if (!li) continue;
    const sortKey = li.invoices?.invoice_date ?? li.invoices?.created_at ?? "";
    const existing = latestByMaterial.get(purchase.material_id);
    if (!existing || sortKey > existing.sortKey) {
      latestByMaterial.set(purchase.material_id, { price: li.unit_price, sortKey });
    }
  }

  const { data: estimate, error: estimateError } = await supabase
    .from("estimates")
    .insert({ project_id: projectId, company_id: companyId, name })
    .select("id")
    .single();

  if (estimateError?.code === POSTGRES_UNIQUE_VIOLATION) {
    return { error: duplicateNameError(name, true) };
  }
  if (estimateError) {
    return { error: estimateError.message };
  }

  const rows: {
    estimate_id: string;
    company_id: string;
    source_line_item_id: string | null;
    description: string;
    quantity: number;
    unit_price: number;
    markup_percent: number;
    total: number;
  }[] = [];

  for (const [materialId, group] of matchedGroups) {
    const avgPrice = group.weightedPriceSum / group.totalQuantity;
    rows.push({
      estimate_id: estimate.id,
      company_id: companyId,
      source_line_item_id: null,
      description: group.name,
      quantity: group.totalQuantity,
      unit_price: avgPrice,
      markup_percent: 0,
      total: computeTotal(group.totalQuantity, avgPrice, 0),
    });

    const latest = latestByMaterial.get(materialId);
    if (latest && Math.abs(latest.price - avgPrice) > 0.0001) {
      rows.push({
        estimate_id: estimate.id,
        company_id: companyId,
        source_line_item_id: null,
        description: `${group.name} (updated price)`,
        quantity: group.totalQuantity,
        unit_price: latest.price,
        markup_percent: 0,
        total: computeTotal(group.totalQuantity, latest.price, 0),
      });
    }
  }

  for (const item of unmatchedItems) {
    rows.push({
      estimate_id: estimate.id,
      company_id: companyId,
      source_line_item_id: item.id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      markup_percent: 0,
      total: computeTotal(item.quantity, item.unit_price, 0),
    });
  }

  if (rows.length > 0) {
    const { error: linesError } = await supabase.from("estimate_lines").insert(rows);
    if (linesError) {
      return { error: `Estimate created, but failed to seed lines: ${linesError.message}` };
    }
  }

  revalidatePath("/estimates");
  revalidatePath(`/projects/${projectId}`);
  redirect(`/estimates/${estimate.id}`);
}

// Snapshot, not a live reference -- source_line_item_id is provenance
// only. See docs/architecture.md -> Estimate-building data flow.
export async function addHistoricalLineToEstimate(
  estimateId: string,
  sourceLineItemId: string,
  description: string,
  quantity: number,
  unitPrice: number,
): Promise<{ error: string | null }> {
  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();

  const ownershipError = await assertEstimateOwnership(supabase, estimateId, companyId);
  if (ownershipError) {
    return { error: ownershipError };
  }

  const { error } = await supabase.from("estimate_lines").insert({
    estimate_id: estimateId,
    company_id: companyId,
    source_line_item_id: sourceLineItemId,
    description,
    quantity,
    unit_price: unitPrice,
    markup_percent: 0,
    total: computeTotal(quantity, unitPrice, 0),
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/estimates/${estimateId}`);
  return { error: null };
}

// Return type is void, not { error } like the other actions here --
// this is bound directly as a <form action={...}> for the "Add blank
// line" button, which requires a (formData) => void | Promise<void>
// signature. Failure just means no new row appears; acceptable for a
// fixed-default insert this unlikely to fail.
export async function addBlankEstimateLine(estimateId: string): Promise<void> {
  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return;
  }
  const supabase = await createClient();

  const ownershipError = await assertEstimateOwnership(supabase, estimateId, companyId);
  if (ownershipError) {
    return;
  }

  await supabase.from("estimate_lines").insert({
    estimate_id: estimateId,
    company_id: companyId,
    source_line_item_id: null,
    description: "New line",
    quantity: 1,
    unit_price: 0,
    markup_percent: 0,
    total: 0,
  });

  revalidatePath(`/estimates/${estimateId}`);
}

export async function updateEstimateLine(
  lineId: string,
  estimateId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<{ error: string | null }> {
  const description = formData.get("description") as string;
  const quantity = Number(formData.get("quantity"));
  const unitPrice = Number(formData.get("unit_price"));
  const markupPercent = Number(formData.get("markup_percent"));

  if (!description || Number.isNaN(quantity) || Number.isNaN(unitPrice) || Number.isNaN(markupPercent)) {
    return { error: "All fields must be valid." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("estimate_lines")
    .update({
      description,
      quantity,
      unit_price: unitPrice,
      markup_percent: markupPercent,
      total: computeTotal(quantity, unitPrice, markupPercent),
    })
    .eq("id", lineId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/estimates/${estimateId}`);
  return { error: null };
}

export async function deleteEstimateLine(
  lineId: string,
  estimateId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("estimate_lines").delete().eq("id", lineId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/estimates/${estimateId}`);
  return { error: null };
}
