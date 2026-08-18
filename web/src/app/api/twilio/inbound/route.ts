import twilioSdk from "twilio";

import { publishProcessDocumentTask } from "@/lib/celery";
import { ALLOWED_TYPES, POSTGRES_UNIQUE_VIOLATION, sha256Hex } from "@/lib/document-intake";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchTwilioMedia, validateTwilioSignature } from "@/lib/twilio";

// Twilio's inbound SMS/MMS webhook -- lets a contractor text a photo of a
// receipt straight into the same extraction pipeline a web upload uses.
// Public by necessity (Twilio calls it directly, no Supabase session),
// authenticated by Twilio's own request signature instead -- see the
// SIGNATURE_AUTHORIZED_PATHS exemption in
// web/src/lib/supabase/middleware.ts. Outside (app) for the same reason
// /sign/[token] is: no session, no company context from a cookie.

function twiml(message: string): Response {
  const response = new twilioSdk.twiml.MessagingResponse();
  response.message(message);
  return new Response(response.toString(), {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case "application/pdf":
      return ".pdf";
    case "image/png":
      return ".png";
    case "image/heic":
      return ".heic";
    case "image/heif":
      return ".heif";
    default:
      return ".jpg";
  }
}

export async function POST(request: Request): Promise<Response> {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = String(value);
  });

  // Must be the exact public URL Twilio computed its signature against --
  // not the request's own URL, which can reflect an internal proxy hop
  // (the same class of bug fixed in web/src/app/auth/callback/route.ts).
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("host");
  const publicUrl = `${proto}://${host}/api/twilio/inbound`;

  const signature = request.headers.get("x-twilio-signature");
  if (!signature || !validateTwilioSignature(signature, publicUrl, params)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const from = params.From;
  const numMedia = Number(params.NumMedia ?? "0");

  const admin = createAdminClient();
  const { data: registered } = await admin
    .from("company_phone_numbers")
    .select("company_id")
    .eq("phone_number", from)
    .maybeSingle();

  if (!registered) {
    return twiml(
      "This number isn't registered with Estimator. Register it under Settings in the app first, then text again.",
    );
  }
  const companyId = registered.company_id;

  if (numMedia === 0) {
    return twiml("Attach a photo of the receipt or invoice you'd like added to your records.");
  }

  let created = 0;
  let skipped = 0;

  for (let i = 0; i < numMedia; i++) {
    const mediaUrl = params[`MediaUrl${i}`];
    const contentType = params[`MediaContentType${i}`];
    if (!mediaUrl || !ALLOWED_TYPES.includes(contentType)) {
      skipped++;
      continue;
    }

    const bytes = await fetchTwilioMedia(mediaUrl);
    const contentHash = await sha256Hex(bytes);

    // Same idempotency guarantee as a web upload -- see
    // documents_company_id_content_hash_unassigned_key
    // (database/migrations/0023_sms_intake.sql), the null-project
    // counterpart to uploadDocument's existing per-project check.
    const { data: duplicate } = await admin
      .from("documents")
      .select("id")
      .eq("company_id", companyId)
      .is("project_id", null)
      .eq("content_hash", contentHash)
      .neq("status", "failed")
      .neq("status", "rejected")
      .limit(1)
      .maybeSingle();
    if (duplicate) {
      skipped++;
      continue;
    }

    const storagePath = `${companyId}/inbox/${crypto.randomUUID()}${extensionForMimeType(contentType)}`;
    const { error: uploadError } = await admin.storage
      .from("documents")
      .upload(storagePath, Buffer.from(bytes), { contentType });
    if (uploadError) {
      skipped++;
      continue;
    }

    const { data: document, error: insertError } = await admin
      .from("documents")
      .insert({
        project_id: null,
        company_id: companyId,
        storage_path: storagePath,
        status: "pending",
        content_hash: contentHash,
      })
      .select("id")
      .single();

    if (insertError?.code === POSTGRES_UNIQUE_VIOLATION) {
      await admin.storage.from("documents").remove([storagePath]);
      skipped++;
      continue;
    }
    if (insertError || !document) {
      skipped++;
      continue;
    }

    try {
      await publishProcessDocumentTask(document.id, companyId, storagePath);
      created++;
    } catch {
      // Document row exists but pipeline kickoff failed -- same recovery
      // shape as a stalled web upload (documents stay "pending", visible
      // and retryable from /inbox once it lists them).
      created++;
    }
  }

  if (created === 0) {
    return twiml(
      skipped > 0
        ? "Couldn't process that photo -- make sure it's a JPEG, PNG, HEIC, or PDF."
        : "Something went wrong receiving that photo. Try again.",
    );
  }

  return twiml(
    `Got it -- processing ${created} photo${created === 1 ? "" : "s"}. Review and confirm in the app when ready.`,
  );
}
