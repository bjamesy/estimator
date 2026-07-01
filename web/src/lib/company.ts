import { createClient } from "@/lib/supabase/server";

// MVP has no multi-company-per-user flow yet, so a user's first membership
// is their only one. See docs/implementation_plan.md -> Phase 1.
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
