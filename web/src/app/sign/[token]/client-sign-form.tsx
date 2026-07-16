"use client";

import { useActionState, useState } from "react";

import { signVersionAsClient } from "@/app/actions/client-signing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MobileSheet } from "@/components/ui/mobile-sheet";
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
  const [mobileOpen, setMobileOpen] = useState(false);

  // Nested label, no id/htmlFor -- this form renders twice at once (desktop
  // copy stays mounted-but-hidden below md while the mobile sheet's copy
  // is open), so a shared id would collide and break label association.
  const fields = (
    <>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          Full name
          <Input name="signer_name" required autoComplete="name" />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          Email (optional)
          <Input name="signer_email" type="email" autoComplete="email" />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" className="mt-0.5" required />
        <span>{CONSENT_STATEMENT}</span>
      </label>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Signing..." : "Sign change order"}
      </Button>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </>
  );

  const description = (
    <p className="text-sm text-muted-foreground">
      Type your full legal name — it will be adopted as your signature and
      recorded with a timestamp.
    </p>
  );

  return (
    <>
      {/* Desktop: inline, as before. */}
      <form action={formAction} className="hidden flex-col gap-4 rounded-lg border p-4 md:flex">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Sign as client</h2>
          {description}
        </div>
        {fields}
      </form>

      {/* Mobile: a single button instead of the full form always sitting
          open at the bottom of the document a client is reviewing on their
          phone -- opens the same form in a sheet. */}
      <Button type="button" onClick={() => setMobileOpen(true)} className="w-full md:hidden">
        Sign as client
      </Button>
      <MobileSheet open={mobileOpen} onClose={() => setMobileOpen(false)} title="Sign as client">
        <form action={formAction} className="flex flex-col gap-4">
          {description}
          {fields}
        </form>
      </MobileSheet>
    </>
  );
}
