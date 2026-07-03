import Link from "next/link";
import { notFound } from "next/navigation";

import { addBlankEstimateLine } from "@/app/actions/estimates";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";

import { EstimateLineRow } from "./estimate-line-row";
import { HistoricalSearch } from "./historical-search";
import { RemovedLines } from "./removed-lines";

export default async function EstimatePage({
  params,
}: {
  params: Promise<{ estimateId: string }>;
}) {
  const { estimateId } = await params;
  const supabase = await createClient();

  const { data: estimate } = await supabase
    .from("estimates")
    .select("id, project_id, name, projects(name)")
    .eq("id", estimateId)
    .single();

  if (!estimate) {
    notFound();
  }

  const projectName = (estimate.projects as unknown as { name: string } | null)?.name;

  const { data: allLines } = await supabase
    .from("estimate_lines")
    .select("id, description, quantity, unit_price, markup_percent, total, deleted_at")
    .eq("estimate_id", estimateId)
    .order("created_at", { ascending: true });

  // Tombstoned lines (deleted_at set) are retained and restorable but
  // excluded from the total and any export -- only active lines count.
  const lines = (allLines ?? []).filter((l) => l.deleted_at === null);
  const removedLines = (allLines ?? []).filter((l) => l.deleted_at !== null);

  const grandTotal = lines.reduce((sum, l) => sum + l.total, 0);

  const addBlankLine = addBlankEstimateLine.bind(null, estimateId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link href="/estimates" className="underline">
            &larr; Back to estimates
          </Link>
          {estimate.project_id && (
            <>
              <span>&middot;</span>
              <Link href={`/projects/${estimate.project_id}`} className="underline">
                Project: {projectName}
              </Link>
            </>
          )}
        </div>
        <h1 className="mt-2 text-2xl font-semibold">{estimate.name}</h1>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Lines</h2>
          <form action={addBlankLine}>
            <Button type="submit" size="sm" variant="outline">
              Add blank line
            </Button>
          </form>
        </div>

        {lines.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                {/* Header is one colSpan-6 cell wrapping the SAME
                    grid-cols-6 layout as each body row (EstimateLineRow),
                    so the labels line up with the input columns. Real <th>
                    cells wouldn't: every body row is a single colSpan-6 cell
                    with its own internal grid, so the table's auto column
                    widths never match. */}
                <TableRow>
                  <TableHead colSpan={6} className="p-0">
                    <div className="grid grid-cols-6 items-center gap-2 p-2 text-muted-foreground">
                      <span className="col-span-2">Description</span>
                      <span>Qty</span>
                      <span>Unit price</span>
                      <span>Markup %</span>
                      <span>Total</span>
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <EstimateLineRow
                    // Keying on total (which changes whenever any editable
                    // field does, via server-side recalculation) forces a
                    // clean remount instead of an in-place update -- the
                    // defaultValue-based inputs below need a remount to
                    // pick up fresh server data without React warning
                    // about changing an uncontrolled input's default value
                    // after the fact.
                    key={`${line.id}-${line.total}`}
                    line={line}
                    estimateId={estimateId}
                  />
                ))}
              </TableBody>
            </Table>
            <p className="text-right text-sm font-medium">
              Estimate total: ${grandTotal.toFixed(2)}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">No lines yet.</p>
        )}

        {removedLines.length > 0 && (
          <RemovedLines estimateId={estimateId} lines={removedLines} />
        )}
      </div>

      <div className="border-t pt-6">
        <HistoricalSearch estimateId={estimateId} />
      </div>
    </div>
  );
}
