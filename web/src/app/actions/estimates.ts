"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { tryGetCurrentCompanyId } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";

function computeTotal(quantity: number, unitPrice: number, markupPercent: number): number {
  return quantity * unitPrice * (1 + markupPercent / 100);
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

// project_id is optional -- Estimates draw on the company-wide historical
// knowledge base, not a specific project's, and aren't required to belong
// to one. See docs/architecture.md -> Estimate-building data flow.
//
// projectId is pre-bound when this is called from a project's page
// (NewEstimateForm projectId={...}); otherwise it's null and the actual
// value (if any) comes from the top-level /estimates page's project
// picker, submitted as formData's "project_id" field.
export async function createEstimate(
  projectId: string | null,
  _prevState: unknown,
  formData: FormData,
) {
  const name = formData.get("name") as string;
  if (!name) {
    return { error: "Estimate name is required." };
  }

  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();

  const rawProjectId = formData.get("project_id") as string | null;
  const resolvedProjectId = projectId ?? (rawProjectId ? rawProjectId : null);

  const { data, error } = await supabase
    .from("estimates")
    .insert({ project_id: resolvedProjectId, company_id: companyId, name })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/estimates");
  if (resolvedProjectId) {
    revalidatePath(`/projects/${resolvedProjectId}`);
  }
  redirect(`/estimates/${data.id}`);
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
