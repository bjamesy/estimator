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

export default async function EstimatePage({
  params,
}: {
  params: Promise<{ id: string; estimateId: string }>;
}) {
  const { id: projectId, estimateId } = await params;
  const supabase = await createClient();

  const { data: estimate } = await supabase
    .from("estimates")
    .select("id, project_id, name")
    .eq("id", estimateId)
    .single();

  if (!estimate || estimate.project_id !== projectId) {
    notFound();
  }

  const { data: lines } = await supabase
    .from("estimate_lines")
    .select("id, description, quantity, unit_price, markup_percent, total")
    .eq("estimate_id", estimateId)
    .order("created_at", { ascending: true });

  const grandTotal = (lines ?? []).reduce((sum, l) => sum + l.total, 0);

  const addBlankLine = addBlankEstimateLine.bind(null, estimateId, projectId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground underline">
          &larr; Back to project
        </Link>
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

        {lines && lines.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead colSpan={2}>Description</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Unit price</TableHead>
                  <TableHead>Markup %</TableHead>
                  <TableHead>Total</TableHead>
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
                    projectId={projectId}
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
      </div>

      <div className="border-t pt-6">
        <HistoricalSearch projectId={projectId} estimateId={estimateId} />
      </div>
    </div>
  );
}
