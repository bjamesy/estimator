"use server";

import { revalidatePath } from "next/cache";

import { publishProcessDocumentTask } from "@/lib/celery";
import { tryGetCurrentCompanyId } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];

export async function uploadDocument(
  projectId: string,
  _prevState: unknown,
  formData: FormData,
) {
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { error: "Only PDF, JPEG, and PNG files are supported." };
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
    // surfacing that distinction to the user is a Phase 3+ UX gap, not
    // something to paper over here with a fake retry.
    return {
      error: `Upload succeeded, but starting processing failed: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  }

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}
