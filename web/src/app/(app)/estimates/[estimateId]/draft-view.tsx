"use client";

import { cn } from "@/lib/utils";

export type DraftLine = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  markup_percent: number;
  total: number;
  priceCheckOutcome: string | null;
};

// The draft reads like a document, not a spreadsheet -- no inputs, nothing
// to type into. A shaded "paper" card + a left accent instead of a full-row
// hover wash is deliberate: it should look like something you're pointing
// at on a page, not a plain app list, so its role as a read-only view (vs.
// the editing tools on the periphery) is visible at a glance, not just
// implied by the absence of inputs. Clicking a line selects it; the
// builder panel is where editing actually happens (see estimate-builder.tsx).
export function DraftView({
  lines,
  grandTotal,
  selectedLineId,
  onSelectLine,
}: {
  lines: DraftLine[];
  grandTotal: number;
  selectedLineId: string | null;
  onSelectLine: (id: string) => void;
}) {
  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed bg-muted/20 px-6 py-16 text-center">
        <p className="text-sm font-medium">This draft is empty</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Add a line from the tools on the right — a blank line, something from your purchasing
          history, or a project&apos;s worth of it at once.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border bg-muted/20 shadow-sm">
        <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span>Draft</span>
          <span>
            {lines.length} line{lines.length === 1 ? "" : "s"}
          </span>
        </div>
        <ul className="flex flex-col divide-y divide-border/70">
          {lines.map((line) => {
            const active = line.id === selectedLineId;
            return (
              <li key={line.id}>
                <button
                  type="button"
                  onClick={() => onSelectLine(line.id)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 border-l-2 px-4 py-3 text-left transition-colors",
                    active
                      ? "border-l-primary bg-accent"
                      : "border-l-transparent hover:border-l-primary/40 hover:bg-background/60",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {line.priceCheckOutcome === "confirmed" && (
                      <span
                        title="Price confirmed against vendor"
                        className="size-1.5 shrink-0 rounded-full bg-emerald-500"
                      />
                    )}
                    {line.priceCheckOutcome === "changed" && (
                      <span
                        title="Vendor price has drifted"
                        className="size-1.5 shrink-0 rounded-full bg-amber-500"
                      />
                    )}
                    <span className="truncate">{line.description}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
                    <span>
                      {line.quantity} × ${line.unit_price.toFixed(2)}
                      {line.markup_percent > 0 && ` +${line.markup_percent}%`}
                    </span>
                    <span className="font-medium text-foreground">${line.total.toFixed(2)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-right text-sm font-medium">Estimate total: ${grandTotal.toFixed(2)}</p>
    </div>
  );
}
