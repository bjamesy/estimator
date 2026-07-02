"use client";

import { useActionState, useRef } from "react";

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
  estimateId,
}: {
  line: EstimateLine;
  estimateId: string;
}) {
  const updateAction = updateEstimateLine.bind(null, line.id, estimateId);
  const [state, formAction, pending] = useActionState(updateAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleDelete() {
    await deleteEstimateLine(line.id, estimateId);
  }

  // Autosaves once focus leaves the row entirely, rather than on every
  // field's blur -- e.relatedTarget is the element about to receive
  // focus; if it's still inside this form (e.g. tabbing description ->
  // quantity), that's not "done editing" yet, so only submit when it
  // isn't.
  function handleBlur(e: React.FocusEvent<HTMLFormElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      formRef.current?.requestSubmit();
    }
  }

  return (
    <TableRow>
      <TableCell colSpan={6} className="p-0">
        <form
          ref={formRef}
          action={formAction}
          onBlur={handleBlur}
          className="grid grid-cols-6 items-center gap-2 p-2"
        >
          <Input name="description" defaultValue={line.description} className="col-span-2" />
          <Input name="quantity" type="number" step="any" defaultValue={line.quantity} />
          <Input name="unit_price" type="number" step="any" defaultValue={line.unit_price} />
          <Input name="markup_percent" type="number" step="any" defaultValue={line.markup_percent} />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {pending ? "Saving..." : `$${line.total.toFixed(2)}`}
            </span>
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
