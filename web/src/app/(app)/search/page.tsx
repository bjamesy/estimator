"use client";

import { useActionState } from "react";

import { searchLineItems, type SearchState } from "@/app/actions/search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { SearchResults } from "./search-results";

const initialState: SearchState = { results: [], error: null, query: "" };

export default function SearchPage() {
  const [state, formAction, pending] = useActionState(searchLineItems, initialState);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="text-muted-foreground">
          Search historical purchases across every project by material, supplier, SKU,
          description, or project.
        </p>
      </div>

      <form action={formAction} className="flex gap-2">
        <Input name="query" placeholder="e.g. PT 2x8" autoFocus required />
        <Button type="submit" disabled={pending}>
          {pending ? "Searching..." : "Search"}
        </Button>
      </form>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      {/* Keyed on the query so a new search resets the table's own filter,
          sort, and page state rather than carrying them across searches. */}
      {state.results.length > 0 && <SearchResults key={state.query} results={state.results} />}

      {state.query && !state.error && state.results.length === 0 && (
        <p className="text-muted-foreground">No results for &ldquo;{state.query}&rdquo;.</p>
      )}
    </div>
  );
}
