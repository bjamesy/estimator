"use client";

import { useActionState } from "react";

import { signVersionAsClient } from "@/app/actions/client-signing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONSENT_STATEMENT } from "@/lib/change-order-copy";

// The client's half of in-house signature capture (v1): typing their
// full name and adopting it as their signature, plus explicit consent to
// the price change. Mechanism isolated behind lib/signatures.ts -- see
// docs/v2/plans/01-change-orders-plan.md -> Phase 3.
export function ClientSignForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    signVersionAsClient.bind(null, token),
    null,
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Sign as client</h2>
        <p className="text-sm text-muted-foreground">
          Type your full legal name — it will be adopted as your signature and
          recorded with a timestamp.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="signer_name">Full name</Label>
          <Input id="signer_name" name="signer_name" required autoComplete="name" />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="signer_email">Email (optional)</Label>
          <Input
            id="signer_email"
            name="signer_email"
            type="email"
            autoComplete="email"
          />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" className="mt-0.5" required />
        <span>{CONSENT_STATEMENT}</span>
      </label>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Signing..." : "Sign change order"}
      </Button>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
