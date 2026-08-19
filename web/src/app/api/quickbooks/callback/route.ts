import { NextResponse, type NextRequest } from "next/server";

import { buildRedirectUri, encryptToken, exchangeCodeForTokens } from "@/lib/quickbooks";
import { createClient } from "@/lib/supabase/server";

// OAuth callback for "Connect QuickBooks" (web/src/app/actions/quickbooks.ts
// -> connectQuickBooks). Unlike the Twilio webhook, this needs no
// middleware exemption: the whole round-trip (Settings -> Intuit's
// consent page -> back here) happens in the user's own browser, so the
// Supabase session cookie is present the entire time -- this is a normal
// authenticated route. state is still validated as OAuth CSRF
// protection (standard practice, independent of whether our own session
// happens to be present), and reading the state row through the
// RLS-scoped client below doubles as confirming the callback belongs to
// the same company that initiated it.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const realmId = searchParams.get("realmId");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const toSettings = (message: string) =>
    NextResponse.redirect(`${origin}/settings?qbo_error=${encodeURIComponent(message)}`);

  if (oauthError) {
    return toSettings(oauthError);
  }
  if (!code || !realmId || !state) {
    return toSettings("QuickBooks did not return the expected data. Try connecting again.");
  }

  const supabase = await createClient();

  const { data: stateRow } = await supabase
    .from("quickbooks_oauth_states")
    .select("id, company_id")
    .eq("state", state)
    .gte("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!stateRow) {
    return toSettings("This connection attempt expired or was already used. Try again.");
  }
  // Single-use, consumed immediately regardless of what happens next.
  await supabase.from("quickbooks_oauth_states").delete().eq("id", stateRow.id);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return toSettings("Not authenticated.");
  }

  try {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    const host = request.headers.get("host") ?? "";
    const tokens = await exchangeCodeForTokens(code, buildRedirectUri(host, proto));

    const { error: upsertError } = await supabase.from("company_quickbooks_connections").upsert(
      {
        company_id: stateRow.company_id,
        realm_id: realmId,
        access_token_encrypted: encryptToken(tokens.accessToken),
        refresh_token_encrypted: encryptToken(tokens.refreshToken),
        access_token_expires_at: tokens.accessTokenExpiresAt.toISOString(),
        refresh_token_expires_at: tokens.refreshTokenExpiresAt.toISOString(),
        connected_by: user.id,
      },
      { onConflict: "company_id" },
    );
    if (upsertError) {
      return toSettings(`Connected, but saving the connection failed: ${upsertError.message}`);
    }
  } catch (err) {
    return toSettings(
      `Could not complete the QuickBooks connection: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }

  return NextResponse.redirect(`${origin}/settings?qbo_connected=1`);
}
