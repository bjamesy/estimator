"use server";

import { randomBytes } from "crypto";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { tryGetCurrentCompanyId } from "@/lib/company";
import {
  buildAuthorizeUrl,
  buildRedirectUri,
  createInvoice,
  decryptToken,
  encryptToken,
  findOrCreateCustomer,
  findOrCreateDefaultItem,
  isQuickBooksConfigured,
  refreshAccessToken,
  type InvoiceLine,
} from "@/lib/quickbooks";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const STATE_TTL_MS = 10 * 60 * 1000;
// Access tokens are refreshed a little before their real expiry so a
// push started right at the boundary doesn't race a still-in-flight
// API call against the old token.
const REFRESH_SKEW_MS = 60 * 1000;

export async function getQuickBooksConnectionStatus(): Promise<{ connected: boolean }> {
  const { companyId, error } = await tryGetCurrentCompanyId();
  if (error !== null) return { connected: false };
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_quickbooks_connections")
    .select("id")
    .eq("company_id", companyId)
    .maybeSingle();
  return { connected: data !== null };
}

// Mints a short-lived state row and returns the Intuit authorize URL to
// redirect the browser to. state ties the callback (which lands on
// Intuit's domain and back, with no Supabase session cookie survival
// guaranteed the way Google's OAuth callback has) back to the company
// and user that started this.
export async function connectQuickBooks(): Promise<{ url: string | null; error: string | null }> {
  if (!isQuickBooksConfigured()) {
    return { url: null, error: "QuickBooks integration is not configured on this deployment." };
  }
  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { url: null, error: companyError };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { url: null, error: "Not authenticated." };
  }

  const state = randomBytes(32).toString("hex");
  const { error: insertError } = await supabase.from("quickbooks_oauth_states").insert({
    company_id: companyId,
    requested_by: user.id,
    state,
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });
  if (insertError) {
    return { url: null, error: `Could not start connection: ${insertError.message}` };
  }

  const h = await headers();
  const redirectUri = buildRedirectUri(h.get("host") ?? "", h.get("x-forwarded-proto") ?? "https");
  return { url: buildAuthorizeUrl(state, redirectUri), error: null };
}

export async function disconnectQuickBooks(): Promise<{ error: string | null }> {
  const { companyId, error } = await tryGetCurrentCompanyId();
  if (error !== null) return { error };
  const supabase = await createClient();
  const { error: deleteError } = await supabase
    .from("company_quickbooks_connections")
    .delete()
    .eq("company_id", companyId);
  if (deleteError) {
    return { error: deleteError.message };
  }
  revalidatePath("/settings");
  return { error: null };
}

// Returns a valid, non-expired access token for the company's
// connection, refreshing (and re-persisting the rotated refresh token)
// first if needed. Uses the admin client -- this runs inside
// pushEstimateVersionToQuickBooks, which already resolved companyId
// under the caller's own session; no session is needed for this
// internal step.
async function getValidAccessToken(companyId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: connection } = await admin
    .from("company_quickbooks_connections")
    .select("id, refresh_token_encrypted, access_token_encrypted, access_token_expires_at")
    .eq("company_id", companyId)
    .single();
  if (!connection) {
    throw new Error("QuickBooks is not connected for this company.");
  }

  const expiresAt = new Date(connection.access_token_expires_at).getTime();
  if (Date.now() < expiresAt - REFRESH_SKEW_MS) {
    return decryptToken(connection.access_token_encrypted);
  }

  const refreshed = await refreshAccessToken(decryptToken(connection.refresh_token_encrypted));
  await admin
    .from("company_quickbooks_connections")
    .update({
      access_token_encrypted: encryptToken(refreshed.accessToken),
      refresh_token_encrypted: encryptToken(refreshed.refreshToken),
      access_token_expires_at: refreshed.accessTokenExpiresAt.toISOString(),
      refresh_token_expires_at: refreshed.refreshTokenExpiresAt.toISOString(),
    })
    .eq("id", connection.id);
  return refreshed.accessToken;
}

type VersionLineRow = {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  change_kind: string;
};

export async function pushEstimateVersionToQuickBooks(
  versionId: string,
  customerName: string,
): Promise<{ error: string | null; invoiceId?: string }> {
  const trimmedName = customerName.trim();
  if (trimmedName.length === 0) {
    return { error: "Enter who this invoice is for." };
  }

  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();

  const { data: version } = await supabase
    .from("estimate_versions")
    .select("id, estimate_id, quickbooks_invoice_id")
    .eq("id", versionId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!version) {
    return { error: "Version not found." };
  }
  if (version.quickbooks_invoice_id) {
    return { error: "This version was already pushed to QuickBooks." };
  }

  const { data: connection } = await supabase
    .from("company_quickbooks_connections")
    .select("id, realm_id, default_item_id")
    .eq("company_id", companyId)
    .maybeSingle();
  if (!connection) {
    return { error: "Connect QuickBooks in Settings first." };
  }

  const { data: linesData } = await supabase
    .from("estimate_version_lines")
    .select("description, quantity, unit_price, total, change_kind")
    .eq("estimate_version_id", versionId);
  // Same filter CSV export uses (export/route.ts) -- you don't invoice
  // for removed scope.
  const lines = ((linesData ?? []) as VersionLineRow[]).filter((l) => l.change_kind !== "removed");
  if (lines.length === 0) {
    return { error: "This version has no lines to invoice." };
  }

  try {
    const accessToken = await getValidAccessToken(companyId);

    const customerId = await findOrCreateCustomer(accessToken, connection.realm_id, trimmedName);

    let itemId = connection.default_item_id;
    if (!itemId) {
      itemId = await findOrCreateDefaultItem(accessToken, connection.realm_id);
      await createAdminClient()
        .from("company_quickbooks_connections")
        .update({ default_item_id: itemId })
        .eq("id", connection.id);
    }

    const invoiceLines: InvoiceLine[] = lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unit_price,
      amount: l.total,
    }));
    const invoiceId = await createInvoice(accessToken, connection.realm_id, customerId, itemId, invoiceLines);

    await supabase
      .from("estimate_versions")
      .update({ quickbooks_invoice_id: invoiceId })
      .eq("id", versionId);

    revalidatePath(`/estimates/${version.estimate_id}/versions/${versionId}`);
    return { error: null, invoiceId };
  } catch (err) {
    return {
      error: `Could not push to QuickBooks: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}
