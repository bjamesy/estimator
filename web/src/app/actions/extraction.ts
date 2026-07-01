"use server";

import { extractInvoiceData, type ExtractionPayload } from "@/lib/extraction";
import { createClient } from "@/lib/supabase/server";

export async function extractDocument(
  documentId: string,
): Promise<{ data: ExtractionPayload | null; error: string | null }> {
  const supabase = await createClient();

  // RLS scopes this to the caller's company; no manual company_id check needed.
  const { data: document, error: docError } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", documentId)
    .single();

  if (docError || !document) {
    return { data: null, error: "Document not found." };
  }

  const { data: file, error: downloadError } = await supabase.storage
    .from("documents")
    .download(document.storage_path);

  if (downloadError || !file) {
    return { data: null, error: `Could not download file: ${downloadError?.message}` };
  }

  const mimeType = file.type || "application/octet-stream";
  if (!["image/jpeg", "image/png"].includes(mimeType)) {
    return {
      data: null,
      error: `Extraction currently only supports JPEG/PNG (Phase 2 is informal). Got: ${mimeType}`,
    };
  }

  try {
    const bytes = await file.arrayBuffer();
    const data = await extractInvoiceData(bytes, mimeType);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Extraction failed." };
  }
}
