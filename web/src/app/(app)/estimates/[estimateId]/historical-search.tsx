"use client";

import { useState } from "react";

import { addHistoricalLineToEstimate } from "@/app/actions/estimates";
import { searchLineItems, type SearchResult } from "@/app/actions/search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function HistoricalSearch({ estimateId }: { estimateId: string }) {
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
      <h2 className="text-lg font-semibold">Add from history</h2>
      <form onSubmit={handleSearch} className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. PT 2x8"
        />
        <Button type="submit" disabled={searching}>
          {searching ? "Searching..." : "Search"}
        </Button>
      </form>

      {results.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Material</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Unit price</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((r) => (
              <TableRow key={r.line_item_id}>
                <TableCell>{r.material_name ?? "—"}</TableCell>
                <TableCell className="max-w-xs truncate">{r.description}</TableCell>
                <TableCell>{r.project_name}</TableCell>
                <TableCell>${r.unit_price.toFixed(2)}</TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={addingId === r.line_item_id}
                    onClick={() => handleAdd(r)}
                  >
                    {addingId === r.line_item_id ? "Adding..." : "Add to estimate"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
