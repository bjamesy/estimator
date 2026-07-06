"use server";

import { revalidatePath } from "next/cache";

import { publishExtractCredentialTask } from "@/lib/celery";
import { tryGetCurrentCompanyId } from "@/lib/company";
import { CREDENTIAL_TYPES, type CredentialType } from "@/lib/credential-types";
import { createClient } from "@/lib/supabase/server";

// Mirrors the document upload allowlist (web/src/app/actions/documents.ts)
// -- same bucket, same pipeline constraints (vision LLM input types).
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
];
const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif"];

// Uploads a certificate for one credential type, superseding any active
// credential of that type (renewal keeps history -- superseded rows are
// retained, per docs/v2/plans/02-verification-plan.md Phase 1), and
// kicks off best-effort field extraction (Phase 2).
export async function uploadCredential(
  credentialType: CredentialType,
  _prevState: unknown,
  formData: FormData,
): Promise<{ error: string | null }> {
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return { error: "Choose a certificate file to upload." };
  }
  const nameLower = file.name.toLowerCase();
  const allowed =
    ALLOWED_TYPES.includes(file.type) ||
    ALLOWED_EXTENSIONS.some((ext) => nameLower.endsWith(ext));
  if (!allowed) {
    return { error: "Use a PDF or photo (JPEG, PNG, HEIC)." };
  }
  if (!CREDENTIAL_TYPES.includes(credentialType)) {
    return { error: "Unknown credential type." };
  }

  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();

  // Path prefix must be company_id -- the storage RLS policy checks the
  // first path segment (database/migrations/0005_storage_bucket.sql).
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${companyId}/credentials/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, file);
  if (uploadError) {
    return { error: `Upload failed: ${uploadError.message}` };
  }

  // Supersede the current active credential of this type BEFORE the
  // insert -- the partial unique index allows only one active row per
  // type, so inserting first would violate it.
  const { error: supersedeError } = await supabase
    .from("credentials")
    .update({ superseded_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("credential_type", credentialType)
    .is("superseded_at", null);
  if (supersedeError) {
    await supabase.storage.from("documents").remove([storagePath]);
    return { error: supersedeError.message };
  }

  const { data: credential, error: insertError } = await supabase
    .from("credentials")
    .insert({
      company_id: companyId,
      credential_type: credentialType,
      storage_path: storagePath,
    })
    .select("id")
    .single();
  if (insertError) {
    await supabase.storage.from("documents").remove([storagePath]);
    return { error: insertError.message };
  }

  // Best-effort: extraction failing just means the contractor types the
  // fields in by hand; the certificate itself is already on file.
  try {
    await publishExtractCredentialTask(credential.id, companyId, storagePath);
  } catch {
    // last_checked_at stays null; the UI offers manual entry regardless.
  }

  revalidatePath("/credentials");
  return { error: null };
}

// Contractor reviews/corrects the extracted fields -- their values are
// authoritative over the machine reading (which stays preserved in
// extraction_result).
export async function updateCredentialFields(
  credentialId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<{ error: string | null }> {
  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();

  const issuedDate = (formData.get("issued_date") as string) || null;
  const expiryDate = (formData.get("expiry_date") as string) || null;
  const provider = (formData.get("provider") as string)?.trim() || null;
  const coverageRaw = (formData.get("coverage_amount") as string)?.trim();
  const coverageAmount = coverageRaw ? Number(coverageRaw) : null;
  if (coverageAmount !== null && Number.isNaN(coverageAmount)) {
    return { error: "Coverage amount must be a number." };
  }

  const { error } = await supabase
    .from("credentials")
    .update({
      issued_date: issuedDate,
      expiry_date: expiryDate,
      provider,
      coverage_amount: coverageAmount,
      // A corrected expiry restarts the reminder ladder; if the new date
      // is in the future, clear a stale 'expired' status too.
      expiry_reminders_sent: 0,
      ...(expiryDate && new Date(expiryDate) > new Date()
        ? { status: "self_reported" }
        : {}),
    })
    .eq("id", credentialId)
    .eq("company_id", companyId);

  if (error) {
    return { error: error.message };
  }
  revalidatePath("/credentials");
  return { error: null };
}
