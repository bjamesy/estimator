"use client";

import { useActionState } from "react";

import { deleteEstimateLine, updateEstimateLine } from "@/app/actions/estimates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";

type EstimateLine = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  markup_percent: number;
  total: number;
};

export function EstimateLineRow({
  line,
  projectId,
  estimateId,
}: {
  line: EstimateLine;
  projectId: string;
  estimateId: string;
}) {
  const updateAction = updateEstimateLine.bind(null, line.id, projectId, estimateId);
  const [state, formAction, pending] = useActionState(updateAction, null);

  async function handleDelete() {
    await deleteEstimateLine(line.id, projectId, estimateId);
  }

  return (
    <TableRow>
      <TableCell colSpan={6} className="p-0">
        <form action={formAction} className="grid grid-cols-6 items-center gap-2 p-2">
          <Input name="description" defaultValue={line.description} className="col-span-2" />
          <Input name="quantity" type="number" step="any" defaultValue={line.quantity} />
          <Input name="unit_price" type="number" step="any" defaultValue={line.unit_price} />
          <Input name="markup_percent" type="number" step="any" defaultValue={line.markup_percent} />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">${line.total.toFixed(2)}</span>
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              {pending ? "Saving..." : "Save"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={handleDelete}>
              Remove
            </Button>
          </div>
        </form>
        {state?.error && <p className="px-2 pb-2 text-sm text-destructive">{state.error}</p>}
      </TableCell>
    </TableRow>
  );
}
