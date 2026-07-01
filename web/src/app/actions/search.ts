"use server";

import { createClient } from "@/lib/supabase/server";

export type SearchResult = {
  line_item_id: string;
  description: string;
  sku: string | null;
  quantity: number;
  unit_price: number;
  total: number;
  material_name: string | null;
  project_id: string;
  project_name: string;
  supplier_name: string;
  invoice_date: string | null;
};

export type SearchState = { results: SearchResult[]; error: string | null; query: string };

export async function searchLineItems(
  _prevState: SearchState,
  formData: FormData,
): Promise<SearchState> {
  const query = (formData.get("query") as string)?.trim();
  if (!query) {
    return { results: [], error: null, query: "" };
  }

  const supabase = await createClient();
  // RLS on the underlying tables scopes this to the caller's company --
  // search_line_items is SECURITY INVOKER (the default), not a bypass.
  // See database/migrations/0007_search_line_items.sql.
  const { data, error } = await supabase.rpc("search_line_items", { search_query: query });

  if (error) {
    return { results: [], error: error.message, query };
  }

  return { results: data ?? [], error: null, query };
}
