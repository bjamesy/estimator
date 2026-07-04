"use client";

import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { SearchResult } from "@/app/actions/search";
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
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

// Columns are declared once so the header, sort comparator, and cell renderer
// all stay in lockstep -- add a column here and it sorts and paginates for
// free. `numeric` picks number vs. locale string ordering.
type Column = {
  key: keyof SearchResult;
  label: string;
  numeric?: boolean;
  align?: "right";
};

const COLUMNS: Column[] = [
  { key: "material_name", label: "Material" },
  { key: "description", label: "Description" },
  { key: "project_name", label: "Project" },
  { key: "supplier_name", label: "Supplier" },
  { key: "invoice_date", label: "Date" },
  { key: "quantity", label: "Qty", numeric: true, align: "right" },
  { key: "unit_price", label: "Unit price", numeric: true, align: "right" },
  { key: "total", label: "Total", numeric: true, align: "right" },
];

// Fields the free-text filter scans -- the human-readable columns, not the
// numeric ones (you filter for "PT 2x8" or a supplier, not for "12.50").
const FILTER_FIELDS: (keyof SearchResult)[] = [
  "material_name",
  "description",
  "project_name",
  "supplier_name",
];

type SortState = { key: keyof SearchResult; dir: "asc" | "desc" };

export function SearchResults({ results }: { results: SearchResult[] }) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return results;
    return results.filter((r) =>
      FILTER_FIELDS.some((f) => String(r[f] ?? "").toLowerCase().includes(q)),
    );
  }, [results, filter]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = COLUMNS.find((c) => c.key === sort.key);
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      // Nulls always sort last regardless of direction, so "—" rows don't
      // crowd the top when sorting descending.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (col?.numeric) return (Number(av) - Number(bv)) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [filtered, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  // Filtering can shrink the list under the current page; clamp so we never
  // show an empty page past the end.
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: keyof SearchResult) {
    setPage(0);
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Input
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
          placeholder="Filter these results…"
          className="max-w-xs"
        />
        <span className="shrink-0 text-sm text-muted-foreground">
          {sorted.length} {sorted.length === 1 ? "result" : "results"}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((col) => {
                const active = sort?.key === col.key;
                const Icon = !active
                  ? ChevronsUpDownIcon
                  : sort.dir === "asc"
                    ? ArrowUpIcon
                    : ArrowDownIcon;
                return (
                  <TableHead key={col.key} className={col.align === "right" ? "text-right" : undefined}>
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={cn(
                        "inline-flex items-center gap-1 transition-colors hover:text-foreground",
                        col.align === "right" && "flex-row-reverse",
                        active ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {col.label}
                      <Icon className="size-3.5" />
                    </button>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((r) => (
              <TableRow key={r.line_item_id}>
                <TableCell>{r.material_name ?? "—"}</TableCell>
                <TableCell className="max-w-xs truncate">{r.description}</TableCell>
                <TableCell>
                  <Link href={`/projects/${r.project_id}`} className="text-primary hover:underline">
                    {r.project_name}
                  </Link>
                </TableCell>
                <TableCell>{r.supplier_name}</TableCell>
                <TableCell>{r.invoice_date ?? "—"}</TableCell>
                <TableCell className="text-right">{r.quantity}</TableCell>
                <TableCell className="text-right">${r.unit_price.toFixed(2)}</TableCell>
                <TableCell className="text-right">${r.total.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {filter && sorted.length === 0 && (
        <p className="text-sm text-muted-foreground">No results match &ldquo;{filter}&rdquo;.</p>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, sorted.length)} of{" "}
            {sorted.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
