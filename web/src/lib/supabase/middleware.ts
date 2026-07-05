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

  if (!user && !isPublicPath && !isTokenAuthorizedPath) {
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
