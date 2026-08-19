"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { pushEstimateVersionToQuickBooks } from "@/app/actions/quickbooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PushToQuickBooks({
  versionId,
  isSigned,
  alreadyPushed,
  connected,
  defaultCustomerName,
}: {
  versionId: string;
  isSigned: boolean;
  alreadyPushed: boolean;
  connected: boolean;
  defaultCustomerName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customerName, setCustomerName] = useState(defaultCustomerName);
  const [error, setError] = useState<string | null>(null);
  const [pushing, startPushing] = useTransition();

  if (alreadyPushed) {
    return <p className="text-sm text-muted-foreground">Pushed to QuickBooks.</p>;
  }

  function handlePush() {
    setError(null);
    startPushing(async () => {
      const result = await pushEstimateVersionToQuickBooks(versionId, customerName);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={!connected}
        title={connected ? undefined : "Connect QuickBooks in Settings first"}
        onClick={() => setOpen(true)}
      >
        Push to QuickBooks
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      {!isSigned && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          This version hasn&apos;t been signed yet. You can still push it, but double-check it&apos;s
          what you want to invoice.
        </p>
      )}
      <Label>
        Bill to (QuickBooks customer name)
        <Input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Client or company name"
        />
      </Label>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pushing || customerName.trim().length === 0}
          onClick={handlePush}
        >
          {pushing ? "Pushing..." : "Confirm push"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
