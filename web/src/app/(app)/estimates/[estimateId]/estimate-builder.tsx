"use client";

import { useState } from "react";

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
// read-only draft (left) and the editing tools (right) both need to agree
// on. Nothing here talks to the server directly; that's all in
// builder-panel.tsx's forms/actions.
export function EstimateBuilder({
  estimateId,
  lines,
  grandTotal,
  projects,
}: {
  estimateId: string;
  lines: BuilderLine[];
  grandTotal: number;
  projects: { id: string; name: string }[];
}) {
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  // Falls back to the add-tools panel on its own if the selected line
  // disappears from underneath it (deleted, or a stale id after a
  // server revalidation) -- no separate "line not found" state needed.
  const selectedLine = lines.find((l) => l.id === selectedLineId) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
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
        onSelectLine={(id) => setSelectedLineId((current) => (current === id ? null : id))}
      />

      <div className="lg:sticky lg:top-20">
        <BuilderPanel
          estimateId={estimateId}
          selectedLine={selectedLine}
          latestPriceCheck={selectedLine?.latestPriceCheck ?? null}
          projects={projects}
          onClose={() => setSelectedLineId(null)}
        />
      </div>
    </div>
  );
}
