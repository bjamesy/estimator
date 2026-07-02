"use server";

import { revalidatePath } from "next/cache";

import { publishMatchMaterialsTask } from "@/lib/celery";
import { extractionPayloadSchema } from "@/lib/extraction-payload";
import { createClient } from "@/lib/supabase/server";

const POSTGRES_UNIQUE_VIOLATION = "23505";

// Postgres ILIKE treats % and _ as wildcards; escape them (and the escape
// character itself) so a supplier name containing either is matched
// literally instead of as a pattern.
function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export async function confirmDocument(documentId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { data: document, error: docError } = await supabase
    .from("documents")
    .select("id, project_id, company_id, status")
    .eq("id", documentId)
    .single();

  if (docError || !document) {
    return { error: "Document not found." };
  }

  if (document.status !== "pending") {
    return { error: `Document is already ${document.status}; cannot confirm again.` };
  }

  const { data: extractionResult, error: erError } = await supabase
    .from("extraction_results")
    .select("payload")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (erError || !extractionResult) {
    return { error: "No extracted data found for this document yet." };
  }

  const parsed = extractionPayloadSchema.safeParse(extractionResult.payload);
  if (!parsed.success) {
    return { error: `Extracted data is malformed: ${parsed.error.message}` };
  }
  const payload = parsed.data;

  // Supplier resolution: match against the global Supplier table by name
  // (case-insensitive, exact match for now). Real auto-matching for
  // variant name phrasings is an open question shared with material
  // matching -- see docs/architecture.md -> Open Questions.
  const supplierName = payload.supplier_name.trim();
  const { data: existingSupplier } = await supabase
    .from("suppliers")
    .select("id")
    .ilike("name", escapeLikePattern(supplierName))
    .limit(1)
    .maybeSingle();

  let supplierId: string;
  if (existingSupplier) {
    supplierId = existingSupplier.id;
  } else {
    const { data: newSupplier, error: supplierError } = await supabase
      .from("suppliers")
      .insert({ name: supplierName })
      .select("id")
      .single();
    if (supplierError || !newSupplier) {
      return { error: `Could not create supplier record: ${supplierError?.message}` };
    }
    supplierId = newSupplier.id;
  }

  // Ensure this company has a CompanySupplier link, whether the supplier
  // was just created or already existed globally.
  const { error: linkError } = await supabase
    .from("company_suppliers")
    .upsert(
      { company_id: document.company_id, supplier_id: supplierId },
      { onConflict: "company_id,supplier_id", ignoreDuplicates: true },
    );
  if (linkError) {
    return { error: `Could not link supplier to company: ${linkError.message}` };
  }

  // Promote: ExtractionResult -> Invoice + LineItem. ExtractionResult
  // itself is never deleted or modified -- it's retained permanently per
  // docs/architecture.md -> ExtractionResult and the Confirm Step.
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .insert({
      project_id: document.project_id,
      document_id: document.id,
      supplier_id: supplierId,
      company_id: document.company_id,
      invoice_date: payload.invoice_date,
      total: payload.total,
    })
    .select("id")
    .single();

  if (invoiceError?.code === POSTGRES_UNIQUE_VIOLATION) {
    // A concurrent confirmDocument call for this same document already
    // won the race (e.g. a double-click, or two tabs open on the same
    // document) -- the unique constraint on invoices.document_id caught
    // it. That request's Invoice/LineItem promotion stands; this one
    // should not create a duplicate.
    return { error: "This document was already confirmed." };
  }
  if (invoiceError || !invoice) {
    return { error: `Could not create invoice: ${invoiceError?.message}` };
  }

  if (payload.line_items.length > 0) {
    const { error: lineItemsError } = await supabase.from("line_items").insert(
      payload.line_items.map((item) => ({
        invoice_id: invoice.id,
        company_id: document.company_id,
        description: item.description,
        sku: item.sku,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.total,
      })),
    );
    if (lineItemsError) {
      return { error: `Could not create line items: ${lineItemsError.message}` };
    }
  }

  const { error: statusError } = await supabase
    .from("documents")
    .update({ status: "confirmed" })
    .eq("id", document.id);

  if (statusError) {
    return {
      error: `Invoice created, but failed to mark document confirmed: ${statusError.message}`,
    };
  }

  // Best-effort: the confirm itself already succeeded (Invoice/LineItem
  // exist, Document is confirmed). A publish failure here just means
  // material matching never runs for this invoice -- worth surfacing, but
  // not worth failing an otherwise-successful confirm over.
  try {
    await publishMatchMaterialsTask(invoice.id, document.company_id);
  } catch {
    // Swallowed intentionally -- see comment above.
  }

  revalidatePath(`/projects/${document.project_id}`);
  revalidatePath(`/projects/${document.project_id}/documents/${document.id}`);
  return { error: null };
}
