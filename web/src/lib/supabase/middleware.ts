import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /auth is public because the OAuth callback runs BEFORE a session exists
// (the user arrives with a `code` and the PKCE verifier cookie, not yet an
// auth session) -- gating it would bounce the callback to /login before it
// can exchange the code. See src/app/auth/callback/route.ts.
const PUBLIC_PATHS = ["/login", "/signup", "/auth"];

// Public like the above, but NOT an auth flow: /sign/[token] is the
// client change-order signing page (see docs/v2/plans/01-change-orders-plan.md
// -> Phase 3), authorized by the token in the URL rather than a session.
// It must not bounce a signed-in user to home either -- a contractor
// opening their own client link should see the page, so it's excluded
// from the "signed-in users skip public pages" redirect below.
const TOKEN_AUTHORIZED_PATHS = ["/sign"];

// Twilio's inbound SMS/MMS webhook (web/src/app/api/twilio/inbound/route.ts)
// -- there is no session (Twilio calls this directly), and it's not a URL
// token like /sign either. It authenticates itself via Twilio's own
// request signature inside the route handler, so it just needs to be
// exempt from the session gate here -- own list so that distinction (and
// the fact that this path's real auth check lives elsewhere) stays
// visible in the code rather than folding it into TOKEN_AUTHORIZED_PATHS.
const SIGNATURE_AUTHORIZED_PATHS = ["/api/twilio"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path),
  );
  const isTokenAuthorizedPath = TOKEN_AUTHORIZED_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path),
  );
  const isSignatureAuthorizedPath = SIGNATURE_AUTHORIZED_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path),
  );

  if (!user && !isPublicPath && !isTokenAuthorizedPath && !isSignatureAuthorizedPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
