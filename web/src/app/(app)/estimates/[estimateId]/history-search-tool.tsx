"use client";

import { useState } from "react";

import { addHistoricalLineToEstimate } from "@/app/actions/estimates";
import { searchLineItems, type SearchResult } from "@/app/actions/search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Compact history search for the builder panel's "add tools" mode -- a
// narrow vertical list rather than the wide table the standalone /search
// page uses, since this lives in a ~300px rail, not the main content area.
export function HistorySearchTool({ estimateId }: { estimateId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    const formData = new FormData();
    formData.set("query", query);
    const state = await searchLineItems({ results: [], error: null, query: "" }, formData);
    setResults(state.results);
    setSearching(false);
  }

  async function handleAdd(result: SearchResult) {
    setAddingId(result.line_item_id);
    await addHistoricalLineToEstimate(
      estimateId,
      result.line_item_id,
      result.description,
      result.quantity,
      result.unit_price,
    );
    setAddingId(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Search history
      </p>
      <form onSubmit={handleSearch} className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. PT 2x8"
          className="h-8 text-sm"
        />
        <Button type="submit" size="sm" disabled={searching}>
          {searching ? "…" : "Search"}
        </Button>
      </form>

      {results.length > 0 && (
        <ul className="flex flex-col gap-1">
          {results.map((r) => (
            <li
              key={r.line_item_id}
              className="flex flex-col gap-1 rounded-md border p-2 text-xs"
            >
              <span className="font-medium">{r.material_name ?? r.description}</span>
              <span className="truncate text-muted-foreground">{r.description}</span>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {r.project_name} · ${r.unit_price.toFixed(2)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  disabled={addingId === r.line_item_id}
                  onClick={() => handleAdd(r)}
                >
                  {addingId === r.line_item_id ? "Adding…" : "Add"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
