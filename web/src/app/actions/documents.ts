"use server";

import { revalidatePath } from "next/cache";

import { publishProcessDocumentTask } from "@/lib/celery";
import { tryGetCurrentCompanyId } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
];
const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif"];

export async function uploadDocument(
  projectId: string,
  _prevState: unknown,
  formData: FormData,
) {
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  // Extension fallback: browsers report an empty file.type for formats
  // they don't natively recognize (HEIC on non-Safari, commonly), which
  // would wrongly reject a valid upload on MIME type alone. The worker
  // side guesses type from the extension anyway (_guess_mime_type in
  // workers/estimator_workers/tasks.py), so extension is an equally
  // authoritative signal here.
  const lowerName = file.name.toLowerCase();
  const allowed =
    ALLOWED_TYPES.includes(file.type) ||
    ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  if (!allowed) {
    return { error: "Only PDF, JPEG, PNG, and HEIC files are supported." };
  }

  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();

  // documents' RLS policy only validates the new row's own company_id,
  // not that project_id actually belongs to that company -- verify
  // explicitly before writing anything (storage upload included).
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!project) {
    return { error: "Project not found." };
  }

  // Path prefix must be company_id -- the storage RLS policy checks the
  // first path segment. See database/migrations/0005_storage_bucket.sql.
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${companyId}/${projectId}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, file);

  if (uploadError) {
    return { error: `Upload failed: ${uploadError.message}` };
  }

  const { data: document, error: insertError } = await supabase
    .from("documents")
    .insert({
      project_id: projectId,
      company_id: companyId,
      storage_path: storagePath,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertError || !document) {
    return { error: `Upload stored, but record creation failed: ${insertError?.message}` };
  }

  try {
    await publishProcessDocumentTask(document.id, companyId, storagePath);
  } catch (err) {
    // The Document row and file both exist; only the pipeline kickoff
    // failed. Document.status stays "pending" with no pipeline events --
    // the documents table detects that staleness and offers Retry
    // (retryDocumentProcessing below), so this isn't a dead end.
    return {
      error: `Upload succeeded, but starting processing failed: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  }

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

// Keep in sync with STALL_THRESHOLD_MS in documents-table.tsx ("use
// server" files may only export async functions, so the constant can't
// be shared directly). 5 minutes comfortably exceeds the pipeline's
// worst legitimate quiet stretch (3 retries with 10/20/30s backoffs).
const STALL_THRESHOLD_MS = 5 * 60 * 1000;

// Recovery for documents stranded in "pending": the pipeline task was
// lost before completing (broker wiped mid-chain, worker down when the
// message arrived, publish failed after the row was created). Distinct
// from terminal *failure* -- a failed document documents what went wrong
// and the answer is re-uploading; a stalled document simply never got
// its work done, and re-publishing is safe by construction: fetch
// re-downloads, extract re-calls the LLM, parse writes a fresh
// ExtractionResult (confirm reads the latest one).
export async function retryDocumentProcessing(
  documentId: string,
): Promise<{ error: string | null }> {
  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();

  const { data: document } = await supabase
    .from("documents")
    .select("id, project_id, company_id, storage_path, status, created_at")
    .eq("id", documentId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!document) {
    return { error: "Document not found." };
  }
  if (document.status !== "pending") {
    return { error: `Document is ${document.status}; only pending documents can be retried.` };
  }

  // Server-side staleness re-check -- the UI gates on the same rule, but
  // this action is directly invocable, and re-publishing a document
  // that's actively processing would run a duplicate pipeline (and pay
  // for duplicate LLM calls) for nothing.
  const { data: extraction } = await supabase
    .from("extraction_results")
    .select("id")
    .eq("document_id", documentId)
    .limit(1)
    .maybeSingle();
  if (extraction) {
    return { error: "Document has already been extracted and is ready for review." };
  }

  const { data: latestEvent } = await supabase
    .from("document_processing_events")
    .select("started_at")
    .eq("document_id", documentId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastActivity = new Date(latestEvent?.started_at ?? document.created_at).getTime();
  if (Date.now() - lastActivity < STALL_THRESHOLD_MS) {
    return { error: "Document appears to still be processing; give it a few minutes first." };
  }

  try {
    await publishProcessDocumentTask(document.id, document.company_id, document.storage_path);
  } catch (err) {
    return {
      error: `Retry failed to start processing: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  }

  revalidatePath(`/projects/${document.project_id}`);
  return { error: null };
}
