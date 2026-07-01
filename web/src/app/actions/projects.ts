"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentCompanyId } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";

export async function createProject(_prevState: unknown, formData: FormData) {
  const name = formData.get("name") as string;
  if (!name) {
    return { error: "Project name is required." };
  }

  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("projects")
    .insert({ company_id: companyId, name })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/projects");
  redirect(`/projects/${data.id}`);
}
