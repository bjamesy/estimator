"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { publishRenderChangeOrderPdfTask } from "@/lib/celery";
import { hashSigningToken } from "@/lib/signatures";
import { createAdminClient } from "@/lib/supabase/admin";

const POSTGRES_UNIQUE_VIOLATION = "23505";

// PUBLIC SURFACE. This action is invoked from the unauthenticated
// /sign/[token] page: the caller has no session and no company. The raw
// token in the URL is the entire authorization -- 256 bits of entropy,
// single-use, expiring, stored only as a hash (see 0017_signatures.sql).
// Everything here runs through the admin client because no RLS identity
// exists for a signing client; every query MUST therefore be keyed off
// the token row's own ids, never off caller-supplied ids.
export async function signVersionAsClient(
  rawToken: string,
  _prevState: unknown,
  formData: FormData,
): Promise<{ error: string }> {
  const signerName = (formData.get("signer_name") as string)?.trim();
  const signerEmail = (formData.get("signer_email") as string)?.trim() || null;
  const consent = formData.get("consent") === "on";
  if (!signerName) {
    return { error: "Type your full name to sign." };
  }
  if (!consent) {
    return { error: "You must confirm the statement to sign." };
  }

  const admin = createAdminClient();

  const { data: token } = await admin
    .from("client_signing_tokens")
    .select("id, estimate_version_id, company_id, expires_at, used_at")
    .eq("token_hash", hashSigningToken(rawToken))
    .maybeSingle();

  // One generic message for unknown tokens -- don't leak whether a
  // guessed token ever existed.
  if (!token) {
    return { error: "This signing link is not valid." };
  }
  if (token.used_at !== null) {
    return { error: "This signing link has already been used." };
  }
  if (new Date(token.expires_at) < new Date()) {
    return { error: "This signing link has expired. Ask your contractor for a new one." };
  }

  const { data: version } = await admin
    .from("estimate_versions")
    .select("id, estimate_id, status")
    .eq("id", token.estimate_version_id)
    .single();
  if (!version || version.status !== "pending_client_signature") {
    // Covers superseded-after-send and already-executed.
    return {
      error:
        "This change order is no longer awaiting a signature. Ask your contractor for the latest version.",
    };
  }

  // Atomic single-use claim: the `is("used_at", null)` predicate makes a
  // raced double-submit lose cleanly -- only one request gets the row.
  const { data: claimed } = await admin
    .from("client_signing_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", token.id)
    .is("used_at", null)
    .select("id");
  if (!claimed || claimed.length === 0) {
    return { error: "This signing link has already been used." };
  }

  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  const { error: signatureError } = await admin.from("estimate_signatures").insert({
    estimate_version_id: version.id,
    company_id: token.company_id,
    signer_role: "client",
    signer_name: signerName,
    signer_email: signerEmail,
    signature_data: signerName,
    ip_address: forwardedFor?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
    user_agent: h.get("user-agent"),
  });

  if (signatureError) {
    // Unclaim so the client can retry -- unless a client signature
    // already exists (raced via a second link), in which case the token
    // staying consumed is correct.
    if (signatureError.code !== POSTGRES_UNIQUE_VIOLATION) {
      await admin
        .from("client_signing_tokens")
        .update({ used_at: null })
        .eq("id", token.id);
      return { error: `Couldn't record the signature: ${signatureError.message}` };
    }
    return { error: "This change order has already been signed." };
  }

  // Signature recorded; execute the version. status predicate guards a
  // raced state change between the check above and here.
  await admin
    .from("estimate_versions")
    .update({
      status: "executed",
      client_signed_at: new Date().toISOString(),
    })
    .eq("id", version.id)
    .eq("status", "pending_client_signature");

  // Kick off the legal PDF render (Phase 4). Best-effort: the signing is
  // already durably recorded, so a broker hiccup must not fail it -- the
  // contractor's version page offers a manual "Generate PDF" retry.
  try {
    await publishRenderChangeOrderPdfTask(version.id, token.company_id);
  } catch {
    // pdf_storage_path stays null; retry surface covers it.
  }

  // Fresh server render of the same URL now shows the executed state.
  redirect(`/sign/${rawToken}`);
}
