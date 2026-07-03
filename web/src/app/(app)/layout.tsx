import { redirect } from "next/navigation";

import { tryGetCurrentCompanyId } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";

import { AppShell } from "./app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Middleware guarantees an authenticated user here, so a failure means the
  // user has no company yet -- a first-time Google sign-in that skipped the
  // signup company-creation step. Send them to onboarding to name one.
  // (/onboarding is in the (auth) group, not under this layout, so no loop.)
  const { companyId, error } = await tryGetCurrentCompanyId();
  if (error) {
    redirect("/onboarding");
  }

  // Data for the shell: account identity (company name preferred, email as
  // fallback) plus the project/estimate lists the sidebar renders as rows.
  // All readable under RLS (company-scoped). Refetched per navigation, so a
  // newly created project/estimate appears after its revalidatePath.
  const supabase = await createClient();
  const [{ data: userData }, { data: company }, { data: projects }, { data: estimates }] =
    await Promise.all([
      supabase.auth.getUser(),
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabase.from("projects").select("id, name").order("created_at", { ascending: false }),
      supabase.from("estimates").select("id, name").order("created_at", { ascending: false }),
    ]);
  const account = company?.name ?? userData.user?.email ?? null;

  return (
    <AppShell account={account} projects={projects ?? []} estimates={estimates ?? []}>
      {children}
    </AppShell>
  );
}
