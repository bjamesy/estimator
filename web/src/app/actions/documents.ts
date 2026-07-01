"use server";

import { revalidatePath } from "next/cache";

import { getCurrentCompanyId } from "@/lib/company";
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

  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

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

  const { error: insertError } = await supabase.from("documents").insert({
    project_id: projectId,
    company_id: companyId,
    storage_path: storagePath,
    status: "pending",
  });

  if (insertError) {
    return { error: `Upload stored, but record creation failed: ${insertError.message}` };
  }

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}
