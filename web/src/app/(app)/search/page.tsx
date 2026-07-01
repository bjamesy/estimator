"use client";

import Link from "next/link";
import { useActionState } from "react";

import { searchLineItems, type SearchState } from "@/app/actions/search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
        <Input name="query" placeholder="e.g. PT 2x8" required />
        <Button type="submit" disabled={pending}>
          {pending ? "Searching..." : "Search"}
        </Button>
      </form>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      {state.results.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Material</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Unit price</TableHead>
              <TableHead>Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.results.map((r) => (
              <TableRow key={r.line_item_id}>
                <TableCell>{r.material_name ?? "—"}</TableCell>
                <TableCell className="max-w-xs truncate">{r.description}</TableCell>
                <TableCell>
                  <Link
                    href={`/projects/${r.project_id}`}
                    className="underline hover:text-foreground"
                  >
                    {r.project_name}
                  </Link>
                </TableCell>
                <TableCell>{r.supplier_name}</TableCell>
                <TableCell>{r.invoice_date ?? "—"}</TableCell>
                <TableCell>{r.quantity}</TableCell>
                <TableCell>${r.unit_price.toFixed(2)}</TableCell>
                <TableCell>${r.total.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {state.query && !state.error && state.results.length === 0 && (
        <p className="text-muted-foreground">No results for &ldquo;{state.query}&rdquo;.</p>
      )}
    </div>
  );
}
