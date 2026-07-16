"use client";

import { ChevronDownIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { restoreEstimateLine } from "@/app/actions/estimates";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RemovedLine = {
  id: string;
  description: string;
  total: number;
};

// Tombstoned estimate lines, recoverable via a one-click Restore. Lives in
// the builder panel's add-tools mode -- it's a draft-recovery tool, the
// same category as the other things there, not something that needs its
// own section on the main page. Collapsed by default since it's rarely
// touched; the count in the toggle is enough to notice it exists.
export function RemovedLines({
  estimateId,
  lines,
}: {
  estimateId: string;
  lines: RemovedLine[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <ChevronDownIcon className={cn("size-3 transition-transform", !open && "-rotate-90")} />
        Removed lines ({lines.length})
      </button>

      {open && (
        <>
          <ul className="flex flex-col gap-1">
            {lines.map((line) => (
              <RemovedLineItem key={line.id} estimateId={estimateId} line={line} />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Excluded from the estimate total and export. Restore one to count it again.
          </p>
        </>
      )}
    </div>
  );
}

function RemovedLineItem({ estimateId, line }: { estimateId: string; line: RemovedLine }) {
  const [pending, startTransition] = useTransition();

  return (
    <li className="flex flex-col gap-1 rounded-md border border-dashed px-2 py-1.5 text-xs">
      <span className="truncate text-muted-foreground line-through">{line.description}</span>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground line-through">${line.total.toFixed(2)}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const { error } = await restoreEstimateLine(line.id, estimateId);
              if (error) {
                toast.error("Couldn't restore line", { description: error });
                return;
              }
              toast.success("Line restored");
            })
          }
        >
          {pending ? "Restoring…" : "Restore"}
        </Button>
      </div>
    </li>
  );
}
