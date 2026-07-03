"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export async function flagMaterialMatch(
  matchId: string,
  projectId: string,
  documentId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  // Flagging only ever changes MaterialMatch.status -- it never touches
  // LineItem, Document, or the original document. See
  // docs/architecture.md -> MaterialMatch.
  const { error } = await supabase
    .from("material_matches")
    .update({ status: "flagged" })
    .eq("id", matchId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}/documents/${documentId}`);
  return { error: null };
}

export async function unflagMaterialMatch(
  matchId: string,
  projectId: string,
  documentId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  // Revert a wrong-flag back to the proposed (accepted) grouping. Like
  // flagging, this only ever changes MaterialMatch.status -- it never
  // touches LineItem, Document, or the original document. Once proposed
  // again, the match counts toward material aggregation and estimate
  // seeding as normal.
  const { error } = await supabase
    .from("material_matches")
    .update({ status: "proposed" })
    .eq("id", matchId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}/documents/${documentId}`);
  return { error: null };
}
