import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

// OAuth return target (set as redirectTo in GoogleButton and allow-listed in
// Supabase's Redirect URLs). Google -> Supabase -> here with a `code`; we
// exchange it for a session cookie, then land the user at the app root. The
// app layout sends first-time users (no company yet) on to /onboarding.
//
// This path is in the middleware's PUBLIC_PATHS: at this point the user has
// the PKCE verifier cookie but not yet a session, so the auth gate would
// otherwise bounce them to /login before the exchange can run.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // request.url resolves against the Next.js standalone server's own bind
  // address (0.0.0.0:3000) when self-hosted behind a reverse proxy (Fly,
  // Caddy) instead of the public host -- build the origin from the
  // forwarded headers the proxy actually sets instead.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const code = searchParams.get("code");
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error");

  const loginWithError = (message: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`);

  if (oauthError) {
    return loginWithError(oauthError);
  }
  if (!code) {
    return loginWithError("Sign-in did not complete. Please try again.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return loginWithError(error.message);
  }

  return NextResponse.redirect(`${origin}/`);
}
