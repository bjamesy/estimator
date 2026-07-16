"use server";

import { revalidatePath } from "next/cache";

import { publishCheckVendorPriceTask } from "@/lib/celery";
import { tryGetCurrentCompanyId } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";
import { validateVendorUrl } from "@/lib/vendors";

// Vendor price spot-checks (docs/v2/plans/05-vendor-price-check-plan.md).
// One saved product URL per estimate line; checks flag drift, they never
// silently substitute the scraped price -- applying it is the
// contractor's explicit action (applyCheckedPrice below).

async function assertLineOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lineId: string,
  companyId: string,
): Promise<{ estimateId: string } | { error: string }> {
  const { data: line } = await supabase
    .from("estimate_lines")
    .select("id, estimate_id")
    .eq("id", lineId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!line) {
    return { error: "Line not found." };
  }
  return { estimateId: line.estimate_id };
}

export async function setLineVendorUrl(
  lineId: string,
  estimateId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<{ error: string | null }> {
  const raw = (formData.get("vendor_product_url") as string)?.trim() ?? "";

  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();
  const owned = await assertLineOwnership(supabase, lineId, companyId);
  if ("error" in owned) {
    return { error: owned.error };
  }

  // Empty clears the URL (and the stale verified stamp with it).
  if (raw === "") {
    const { error } = await supabase
      .from("estimate_lines")
      .update({ vendor_product_url: null, price_verified_at: null })
      .eq("id", lineId);
    if (error) return { error: error.message };
    revalidatePath(`/estimates/${estimateId}`);
    return { error: null };
  }

  const { error: urlError } = validateVendorUrl(raw);
  if (urlError) {
    return { error: urlError };
  }

  const { error } = await supabase
    .from("estimate_lines")
    .update({ vendor_product_url: raw, price_verified_at: null })
    .eq("id", lineId);
  if (error) {
    return { error: error.message };
  }
  revalidatePath(`/estimates/${estimateId}`);
  return { error: null };
}

export async function checkLinePrice(
  lineId: string,
  estimateId: string,
  _prevState: unknown,
  _formData: FormData,
): Promise<{ error: string | null; queued?: boolean }> {
  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();
  const owned = await assertLineOwnership(supabase, lineId, companyId);
  if ("error" in owned) {
    return { error: owned.error };
  }

  const { data: line } = await supabase
    .from("estimate_lines")
    .select("vendor_product_url")
    .eq("id", lineId)
    .single();
  if (!line?.vendor_product_url) {
    return { error: "Save a vendor product URL first." };
  }

  try {
    await publishCheckVendorPriceTask(lineId, companyId);
  } catch (exc) {
    return {
      error: `Couldn't queue the check: ${exc instanceof Error ? exc.message : "unknown error"}`,
    };
  }
  return { error: null, queued: true };
}

// The contractor's explicit "use the vendor's price" action after a
// 'changed' flag -- the only path by which a fetched price ever reaches
// the line. Recomputes the total like updateEstimateLine does.
export async function applyCheckedPrice(
  lineId: string,
  estimateId: string,
  newUnitPrice: number,
): Promise<{ error: string | null }> {
  if (!Number.isFinite(newUnitPrice) || newUnitPrice < 0) {
    return { error: "Invalid price." };
  }
  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();
  const owned = await assertLineOwnership(supabase, lineId, companyId);
  if ("error" in owned) {
    return { error: owned.error };
  }

  const { data: line } = await supabase
    .from("estimate_lines")
    .select("quantity, markup_percent")
    .eq("id", lineId)
    .single();
  if (!line) {
    return { error: "Line not found." };
  }

  const total = line.quantity * newUnitPrice * (1 + line.markup_percent / 100);
  const { error } = await supabase
    .from("estimate_lines")
    .update({
      unit_price: newUnitPrice,
      total,
      // The line now matches what the vendor page said -- stamp it.
      price_verified_at: new Date().toISOString(),
    })
    .eq("id", lineId);
  if (error) {
    return { error: error.message };
  }
  revalidatePath(`/estimates/${estimateId}`);
  return { error: null };
}
