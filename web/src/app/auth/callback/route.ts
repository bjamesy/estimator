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
  const { searchParams, origin } = new URL(request.url);
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
