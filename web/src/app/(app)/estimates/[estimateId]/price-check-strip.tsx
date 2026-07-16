"use client";

import { useActionState, useState, useTransition } from "react";

import {
  applyCheckedPrice,
  checkLinePrice,
  setLineVendorUrl,
} from "@/app/actions/vendor-price";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type PriceCheck = {
  outcome: string;
  fetched_price: number | null;
  estimate_price: number;
  checked_at: string;
};

// Per-line vendor price spot-check controls, rendered under the line's
// edit form. Flags drift; never applies a price without the contractor
// clicking "Use $X". See docs/v2/plans/05-vendor-price-check-plan.md.
export function PriceCheckStrip({
  lineId,
  estimateId,
  vendorUrl,
  priceVerifiedAt,
  latestCheck,
}: {
  lineId: string;
  estimateId: string;
  vendorUrl: string | null;
  priceVerifiedAt: string | null;
  latestCheck: PriceCheck | null;
}) {
  const [urlState, urlAction, urlPending] = useActionState(
    setLineVendorUrl.bind(null, lineId, estimateId),
    null,
  );
  const [checkState, checkAction, checkPending] = useActionState(
    checkLinePrice.bind(null, lineId, estimateId),
    null,
  );
  const [applying, startApplying] = useTransition();
  const [applyError, setApplyError] = useState<string | null>(null);

  const result = (() => {
    if (checkState?.queued) {
      return (
        <span className="text-muted-foreground">
          Checking vendor price… refresh in a moment.
        </span>
      );
    }
    if (!latestCheck) return null;
    const when = new Date(latestCheck.checked_at).toLocaleDateString();
    if (latestCheck.outcome === "confirmed") {
      return (
        <span className="text-emerald-700 dark:text-emerald-400">
          Price confirmed — no change since your last order (checked {when})
        </span>
      );
    }
    if (latestCheck.outcome === "changed" && latestCheck.fetched_price !== null) {
      return (
        <span className="flex flex-wrap items-center gap-2 text-amber-700 dark:text-amber-400">
          Vendor price appears to have changed to ${latestCheck.fetched_price.toFixed(2)} (was $
          {latestCheck.estimate_price.toFixed(2)} here, checked {when}). Estimate still uses your
          price — review recommended.
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={applying}
            onClick={() => {
              setApplyError(null);
              startApplying(async () => {
                const { error } = await applyCheckedPrice(
                  lineId,
                  estimateId,
                  latestCheck.fetched_price as number,
                );
                if (error) setApplyError(error);
              });
            }}
          >
            {applying ? "Applying..." : `Use $${latestCheck.fetched_price.toFixed(2)}`}
          </Button>
        </span>
      );
    }
    return (
      <span className="text-muted-foreground">
        Couldn&apos;t verify current price — using your price (checked {when})
      </span>
    );
  })();

  return (
    <div className="flex flex-col gap-1 px-2 pb-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <form action={urlAction} className="flex min-w-0 flex-1 items-center gap-2">
          <Input
            name="vendor_product_url"
            type="url"
            placeholder="Vendor product URL (homedepot.ca, rona.ca, homehardware.ca)"
            defaultValue={vendorUrl ?? ""}
            className="h-7 flex-1 text-xs"
          />
          <Button type="submit" size="sm" variant="ghost" disabled={urlPending}>
            {urlPending ? "Saving..." : "Save URL"}
          </Button>
        </form>
        <form action={checkAction}>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={checkPending || !vendorUrl}
          >
            {checkPending ? "Queuing..." : "Check price"}
          </Button>
        </form>
        {priceVerifiedAt && (
          <span className="text-muted-foreground">
            Price verified {new Date(priceVerifiedAt).toLocaleDateString()}
          </span>
        )}
      </div>
      {result}
      {urlState?.error && <p className="text-destructive">{urlState.error}</p>}
      {checkState?.error && <p className="text-destructive">{checkState.error}</p>}
      {applyError && <p className="text-destructive">{applyError}</p>}
    </div>
  );
}
