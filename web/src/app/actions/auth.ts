"use server";

import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function signup(_prevState: unknown, formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const companyName = formData.get("companyName") as string;

  if (!email || !password || !companyName) {
    return { error: "Email, password, and company name are all required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { error: error.message };
  }
  if (!data.user) {
    return { error: "Sign up did not return a user. Please try again." };
  }

  // Bypasses RLS by design: creating the first company_members row is what
  // grants access to everything else, so it can't be gated by the RLS it's
  // about to satisfy. See docs/architecture.md -> Company Scoping.
  const admin = createAdminClient();
  const { data: company, error: companyError } = await admin
    .from("companies")
    .insert({ name: companyName })
    .select("id")
    .single();

  if (companyError) {
    return { error: `Account created, but company setup failed: ${companyError.message}` };
  }

  const { error: memberError } = await admin.from("company_members").insert({
    company_id: company.id,
    user_id: data.user.id,
    role: "owner",
  });

  if (memberError) {
    return { error: `Account created, but company setup failed: ${memberError.message}` };
  }

  if (!data.session) {
    return {
      error: null,
      message: "Check your email to confirm your account, then log in.",
    };
  }

  redirect("/projects");
}

export async function login(_prevState: unknown, formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  redirect("/projects");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
