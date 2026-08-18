"use server";

import { randomInt, createHash } from "crypto";

import { revalidatePath } from "next/cache";

import { tryGetCurrentCompanyId } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";
import { sendSms } from "@/lib/twilio";

const E164 = /^\+[1-9]\d{6,14}$/;
const CODE_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 3;
const MAX_VERIFY_ATTEMPTS = 5;
const POSTGRES_UNIQUE_VIOLATION = "23505";

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

// Sends a 6-digit code to phoneNumber via SMS, tying the challenge to the
// caller's company so verifyPhoneCode can't be used to register a number
// under a different company than the one that requested the code.
export async function sendPhoneVerificationCode(
  phoneNumber: string,
): Promise<{ error: string | null }> {
  if (!E164.test(phoneNumber)) {
    return { error: "Enter a phone number in international format, e.g. +15551234567." };
  }

  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not authenticated." };
  }

  const { count } = await supabase
    .from("phone_otp_requests")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .gte("created_at", new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString());
  if ((count ?? 0) >= RATE_LIMIT_MAX_REQUESTS) {
    return { error: "Too many codes requested. Try again in a few minutes." };
  }

  const code = String(randomInt(100000, 1000000));
  const { error: insertError } = await supabase.from("phone_otp_requests").insert({
    company_id: companyId,
    requested_by: user.id,
    phone_number: phoneNumber,
    code_hash: hashCode(code),
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (insertError) {
    return { error: `Could not start verification: ${insertError.message}` };
  }

  try {
    await sendSms(phoneNumber, `Your Estimator verification code is ${code}`);
  } catch (err) {
    return {
      error: `Could not send code: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }

  return { error: null };
}

// Confirms the code and, on success, claims phoneNumber for the caller's
// company in company_phone_numbers -- the table the Twilio inbound
// webhook trusts to route an incoming text to a company with no session
// involved.
export async function verifyPhoneCode(
  phoneNumber: string,
  code: string,
): Promise<{ error: string | null }> {
  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not authenticated." };
  }

  const { data: request } = await supabase
    .from("phone_otp_requests")
    .select("id, code_hash, attempts")
    .eq("company_id", companyId)
    .eq("phone_number", phoneNumber)
    .is("consumed_at", null)
    .gte("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!request) {
    return { error: "No pending code for this number. Request a new one." };
  }
  if (request.attempts >= MAX_VERIFY_ATTEMPTS) {
    return { error: "Too many incorrect attempts. Request a new code." };
  }

  if (hashCode(code) !== request.code_hash) {
    await supabase
      .from("phone_otp_requests")
      .update({ attempts: request.attempts + 1 })
      .eq("id", request.id);
    return { error: "Incorrect code." };
  }

  await supabase
    .from("phone_otp_requests")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", request.id);

  const { error: insertError } = await supabase.from("company_phone_numbers").insert({
    company_id: companyId,
    phone_number: phoneNumber,
    created_by: user.id,
  });
  if (insertError?.code === POSTGRES_UNIQUE_VIOLATION) {
    return { error: "This number is already registered to a company." };
  }
  if (insertError) {
    return { error: `Verification succeeded but registration failed: ${insertError.message}` };
  }

  revalidatePath("/settings");
  return { error: null };
}

export async function listRegisteredPhoneNumbers(): Promise<
  { phoneNumber: string; verifiedAt: string }[]
> {
  const { companyId, error } = await tryGetCurrentCompanyId();
  if (error !== null) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_phone_numbers")
    .select("phone_number, verified_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((row) => ({ phoneNumber: row.phone_number, verifiedAt: row.verified_at }));
}

export async function removePhoneNumber(phoneNumber: string): Promise<{ error: string | null }> {
  const { companyId, error } = await tryGetCurrentCompanyId();
  if (error !== null) return { error };
  const supabase = await createClient();
  const { error: deleteError } = await supabase
    .from("company_phone_numbers")
    .delete()
    .eq("company_id", companyId)
    .eq("phone_number", phoneNumber);
  if (deleteError) {
    return { error: deleteError.message };
  }
  revalidatePath("/settings");
  return { error: null };
}
