"use client";

import { useActionState } from "react";

import { snapshotEstimateVersion } from "@/app/actions/change-orders";
import { Button } from "@/components/ui/button";

// Freezes the current draft lines into a new immutable version -- the
// substrate for change orders. See docs/v2/plans/01-change-orders-plan.md.
export function SnapshotVersionForm({
  estimateId,
  nextVersionNumber,
}: {
  estimateId: string;
  nextVersionNumber: number;
}) {
  const [state, formAction, pending] = useActionState(
    snapshotEstimateVersion.bind(null, estimateId),
    null,
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending
            ? "Snapshotting..."
            : nextVersionNumber === 1
              ? "Snapshot as version 1"
              : `Snapshot as version ${nextVersionNumber}`}
        </Button>
      </form>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </div>
  );
}
