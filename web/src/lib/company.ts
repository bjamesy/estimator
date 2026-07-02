import { createClient } from "@/lib/supabase/server";

// MVP has no multi-company-per-user flow yet, so a user's first membership
// is their only one. See docs/mvp/implementation_plan.md -> Phase 1.
export async function getCurrentCompanyId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const { data, error } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error("No company found for this user");
  }

  return data.company_id;
}

// getCurrentCompanyId() throws (a company_members row missing for a
// logged-in user is a real invariant violation, not an expected failure
// mode), but every server action calling it otherwise returns
// { error: string | null } for every other failure path, and previously
// called it unguarded -- a throw here surfaced as Next's generic
// unhandled-server-action error instead of the action's own inline
// message. This centralizes the conversion so each call site doesn't
// have to repeat the same try/catch.
export async function tryGetCurrentCompanyId(): Promise<
  { companyId: string; error: null } | { companyId: null; error: string }
> {
  try {
    return { companyId: await getCurrentCompanyId(), error: null };
  } catch (err) {
    return {
      companyId: null,
      error: err instanceof Error ? err.message : "Could not resolve your company.",
    };
  }
}
