"use client";

import { useTransition } from "react";

import { restoreEstimateLine } from "@/app/actions/estimates";
import { Button } from "@/components/ui/button";

type RemovedLine = {
  id: string;
  description: string;
  total: number;
};

// Tombstoned estimate lines. Kept visible but struck through and excluded
// from the total, with a one-click Restore that clears the tombstone.
export function RemovedLines({
  estimateId,
  lines,
}: {
  estimateId: string;
  lines: RemovedLine[];
}) {
  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <h3 className="text-sm font-medium text-muted-foreground">Removed lines</h3>
      <ul className="flex flex-col gap-1">
        {lines.map((line) => (
          <RemovedLineItem key={line.id} estimateId={estimateId} line={line} />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Removed lines are excluded from the estimate total and export. Restore one to count it
        again.
      </p>
    </div>
  );
}

function RemovedLineItem({ estimateId, line }: { estimateId: string; line: RemovedLine }) {
  const [pending, startTransition] = useTransition();

  return (
    <li className="flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-sm">
      <span className="text-muted-foreground line-through">{line.description}</span>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground line-through">${line.total.toFixed(2)}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await restoreEstimateLine(line.id, estimateId);
            })
          }
        >
          {pending ? "Restoring..." : "Restore"}
        </Button>
      </div>
    </li>
  );
}
