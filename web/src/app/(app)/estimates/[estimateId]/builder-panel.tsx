"use client";

import { useActionState, useRef, useTransition } from "react";

import { addBlankEstimateLine, deleteEstimateLine, updateEstimateLine } from "@/app/actions/estimates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { HistorySearchTool } from "./history-search-tool";
import { ImportProjectTool } from "./import-project-tool";
import { PriceCheckStrip, type PriceCheck } from "./price-check-strip";

export type SelectedLine = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  markup_percent: number;
  total: number;
  vendor_product_url: string | null;
  price_verified_at: string | null;
};

// The periphery: everything that changes the draft happens here, never in
// the draft view itself. Two modes -- add tools when nothing's selected,
// an edit form for the selected line when something is. See
// estimate-builder.tsx for the selection state this switches on.
export function BuilderPanel({
  estimateId,
  selectedLine,
  latestPriceCheck,
  projects,
  onClose,
}: {
  estimateId: string;
  selectedLine: SelectedLine | null;
  latestPriceCheck: PriceCheck | null;
  projects: { id: string; name: string }[];
  onClose: () => void;
}) {
  if (selectedLine) {
    return (
      <EditLinePanel
        // Remount on save so the defaultValue-based inputs pick up fresh
        // server data without React warning about an uncontrolled input's
        // default changing after the fact -- same trick the old inline row
        // editor used.
        key={`${selectedLine.id}-${selectedLine.total}-${selectedLine.vendor_product_url ?? ""}`}
        estimateId={estimateId}
        line={selectedLine}
        latestPriceCheck={latestPriceCheck}
        onClose={onClose}
      />
    );
  }

  const addBlankLine = addBlankEstimateLine.bind(null, estimateId);

  return (
    <div className="flex flex-col gap-5 rounded-lg border p-4">
      <div>
        <h2 className="text-sm font-semibold">Add a line</h2>
        <p className="text-xs text-muted-foreground">
          Click a line in the draft to edit it, or add a new one below.
        </p>
      </div>

      <form action={addBlankLine}>
        <Button type="submit" size="sm" variant="outline" className="w-full">
          Add blank line
        </Button>
      </form>

      <div className="border-t pt-4">
        <HistorySearchTool estimateId={estimateId} />
      </div>

      <div className="border-t pt-4">
        <ImportProjectTool estimateId={estimateId} projects={projects} />
      </div>
    </div>
  );
}

function EditLinePanel({
  estimateId,
  line,
  latestPriceCheck,
  onClose,
}: {
  estimateId: string;
  line: SelectedLine;
  latestPriceCheck: PriceCheck | null;
  onClose: () => void;
}) {
  const updateAction = updateEstimateLine.bind(null, line.id, estimateId);
  const [state, formAction, pending] = useActionState(updateAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const [deleting, startDeleting] = useTransition();

  // Autosaves once focus leaves the form entirely (same behavior as the
  // old inline row editor) -- e.relatedTarget is the element about to
  // receive focus; if it's still inside this form, that's not "done
  // editing" yet.
  function handleBlur(e: React.FocusEvent<HTMLFormElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      formRef.current?.requestSubmit();
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Edit line</h2>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>

      <form ref={formRef} action={formAction} onBlur={handleBlur} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Description
          <Input name="description" defaultValue={line.description} />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Qty
            <Input name="quantity" type="number" step="any" defaultValue={line.quantity} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Unit price
            <Input name="unit_price" type="number" step="any" defaultValue={line.unit_price} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Markup %
            <Input
              name="markup_percent"
              type="number"
              step="any"
              defaultValue={line.markup_percent}
            />
          </label>
        </div>
        <p className="text-sm text-muted-foreground">
          {pending ? "Saving…" : `Total: $${line.total.toFixed(2)}`}
        </p>
      </form>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="border-t pt-3">
        <PriceCheckStrip
          lineId={line.id}
          estimateId={estimateId}
          vendorUrl={line.vendor_product_url}
          priceVerifiedAt={line.price_verified_at}
          latestCheck={latestPriceCheck}
        />
      </div>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        disabled={deleting}
        onClick={() =>
          startDeleting(async () => {
            await deleteEstimateLine(line.id, estimateId);
            onClose();
          })
        }
      >
        {deleting ? "Removing…" : "Remove line"}
      </Button>
    </div>
  );
}
