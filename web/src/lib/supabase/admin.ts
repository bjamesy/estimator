import { createClient } from "@supabase/supabase-js";

// Server-only. Bypasses RLS via SUPABASE_SECRET_KEY -- never import this
// into client components. Used for operations that must cross the
// company-scoping boundary, e.g. creating a company and its first
// company_members row atomically during signup.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  );
}
