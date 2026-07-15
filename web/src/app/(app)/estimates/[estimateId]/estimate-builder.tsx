"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { BuilderPanel } from "./builder-panel";
import { DraftView } from "./draft-view";
import type { PriceCheck } from "./price-check-strip";

export type BuilderLine = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  markup_percent: number;
  total: number;
  vendor_product_url: string | null;
  price_verified_at: string | null;
  latestPriceCheck: PriceCheck | null;
};

// Owns which line (if any) is selected -- the one piece of state the
// read-only draft and the editing tools both need to agree on, plus (below
// lg) whether the mobile tools sheet is open. On desktop the tools are an
// always-visible side rail; below lg there's no room for that, so the same
// BuilderPanel renders inside a bottom sheet instead, opened either by the
// "Add a line" trigger above the draft or by tapping a line directly (both
// devices; render logic stays desktop-vs-mobile via CSS, mounting stays
// the same as the sidebar's mobile-drawer pattern in app-shell.tsx --
// always mounted, shown/hidden via classes, not conditionally rendered).
export function EstimateBuilder({
  estimateId,
  lines,
  grandTotal,
  projects,
  removedLines,
}: {
  estimateId: string;
  lines: BuilderLine[];
  grandTotal: number;
  projects: { id: string; name: string }[];
  removedLines: { id: string; description: string; total: number }[];
}) {
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  // Falls back to the add-tools panel on its own if the selected line
  // disappears from underneath it (deleted, or a stale id after a
  // server revalidation) -- no separate "line not found" state needed.
  const selectedLine = lines.find((l) => l.id === selectedLineId) ?? null;

  function closePanel() {
    setSelectedLineId(null);
    setMobileSheetOpen(false);
  }

  function selectLine(id: string) {
    setSelectedLineId((current) => (current === id ? null : id));
    setMobileSheetOpen(true);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
      {/* Above the draft, not below it -- the point is noticing you can
          edit without scrolling past every line first. */}
      <button
        type="button"
        onClick={() => setMobileSheetOpen(true)}
        className="flex items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-solid hover:text-foreground lg:hidden"
      >
        <PlusIcon className="size-4" />
        Add lines
      </button>

      <DraftView
        lines={lines.map((l) => ({
          id: l.id,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          markup_percent: l.markup_percent,
          total: l.total,
          priceCheckOutcome: l.latestPriceCheck?.outcome ?? null,
        }))}
        grandTotal={grandTotal}
        selectedLineId={selectedLineId}
        onSelectLine={selectLine}
      />

      {/* Desktop: always-visible side rail. */}
      <div className="hidden lg:sticky lg:top-20 lg:block">
        <BuilderPanel
          estimateId={estimateId}
          selectedLine={selectedLine}
          latestPriceCheck={selectedLine?.latestPriceCheck ?? null}
          projects={projects}
          removedLines={removedLines}
          onClose={closePanel}
        />
      </div>

      {/* Mobile: same panel, in a bottom sheet, only ever mounted (and
          only ever relevant) below lg -- lg:hidden on the wrapper is a
          backstop in case mobileSheetOpen is ever true at a wide viewport
          (e.g. resizing mid-session). */}
      {mobileSheetOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={closePanel} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-xl border-t bg-background shadow-lg">
            <div className="flex items-center justify-end border-b p-2">
              <Button type="button" variant="ghost" size="icon" onClick={closePanel}>
                <XIcon className="size-4" />
              </Button>
            </div>
            <div className="overflow-y-auto p-4">
              <BuilderPanel
                estimateId={estimateId}
                selectedLine={selectedLine}
                latestPriceCheck={selectedLine?.latestPriceCheck ?? null}
                projects={projects}
                removedLines={removedLines}
                onClose={closePanel}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
