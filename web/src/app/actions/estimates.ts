"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentCompanyId } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";

function computeTotal(quantity: number, unitPrice: number, markupPercent: number): number {
  return quantity * unitPrice * (1 + markupPercent / 100);
}

export async function createEstimate(projectId: string, _prevState: unknown, formData: FormData) {
  const name = formData.get("name") as string;
  if (!name) {
    return { error: "Estimate name is required." };
  }

  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("estimates")
    .insert({ project_id: projectId, company_id: companyId, name })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}/estimates/${data.id}`);
}

// Snapshot, not a live reference -- source_line_item_id is provenance
// only. See docs/architecture.md -> Estimate-building data flow.
export async function addHistoricalLineToEstimate(
  estimateId: string,
  projectId: string,
  sourceLineItemId: string,
  description: string,
  quantity: number,
  unitPrice: number,
): Promise<{ error: string | null }> {
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

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

  revalidatePath(`/projects/${projectId}/estimates/${estimateId}`);
  return { error: null };
}

// Return type is void, not { error } like the other actions here --
// this is bound directly as a <form action={...}> for the "Add blank
// line" button, which requires a (formData) => void | Promise<void>
// signature. Failure just means no new row appears; acceptable for a
// fixed-default insert this unlikely to fail.
export async function addBlankEstimateLine(estimateId: string, projectId: string): Promise<void> {
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

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

  revalidatePath(`/projects/${projectId}/estimates/${estimateId}`);
}

export async function updateEstimateLine(
  lineId: string,
  projectId: string,
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

  revalidatePath(`/projects/${projectId}/estimates/${estimateId}`);
  return { error: null };
}

export async function deleteEstimateLine(
  lineId: string,
  projectId: string,
  estimateId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("estimate_lines").delete().eq("id", lineId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}/estimates/${estimateId}`);
  return { error: null };
}
