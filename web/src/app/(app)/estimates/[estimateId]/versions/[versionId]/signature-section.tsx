"use client";

import { useActionState, useState } from "react";

import {
  regenerateSigningLink,
  requestChangeOrderPdf,
  signVersionAsContractor,
} from "@/app/actions/change-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MobileSheet } from "@/components/ui/mobile-sheet";
import { CONSENT_STATEMENT } from "@/lib/change-order-copy";

// Contractor-side signing UI for a version page. Which piece renders is
// decided by the server component from version.status -- see page.tsx.

function CopyableLink({ url, emailedTo }: { url: string; emailedTo?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
      <p className="font-medium text-emerald-800 dark:text-emerald-300">
        {emailedTo
          ? `Signing link emailed to ${emailedTo}. You can also send it yourself — for the client's security it can't be shown again, only replaced.`
          : "Client signing link — send it to your client. For their security it can't be shown again, only replaced."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-background/60 px-2 py-1 text-xs">
          {url}
        </code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}

// Contractor signs a draft version: typed full name adopted as the
// signature (v1 in-house capture -- see lib/signatures.ts) plus the
// consent statement. On success the client signing link is shown once.
export function SignContractorForm({
  versionId,
  estimateId,
}: {
  versionId: string;
  estimateId: string;
}) {
  const [state, formAction, pending] = useActionState(
    signVersionAsContractor.bind(null, versionId, estimateId),
    null,
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  if (state?.signingUrl) {
    return <CopyableLink url={state.signingUrl} emailedTo={state.emailedTo} />;
  }

  // Nested label, no id/htmlFor -- this form renders twice at once (desktop
  // copy stays mounted-but-hidden below md while the mobile sheet's copy
  // is open), so a shared id would collide and break label association.
  const fields = (
    <>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1.5 text-sm sm:max-w-sm">
          Full name
          <Input name="signer_name" required autoComplete="name" />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm sm:max-w-sm">
          Client email (optional)
          <Input name="client_email" type="email" placeholder="Sends them the signing link" />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" className="mt-0.5" required />
        <span>{CONSENT_STATEMENT}</span>
      </label>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Signing..." : "Sign and create client link"}
      </Button>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </>
  );

  const description = (
    <p className="text-sm text-muted-foreground">
      Type your full legal name — it will be adopted as your signature and
      recorded with a timestamp. Signing locks this version and creates the
      link your client signs through.
    </p>
  );

  return (
    <>
      {/* Desktop: inline, as before. */}
      <form action={formAction} className="hidden flex-col gap-4 rounded-lg border p-4 md:flex">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Sign as contractor</h2>
          {description}
        </div>
        {fields}
      </form>

      {/* Mobile: a single button instead of the full form always sitting
          open at the bottom of the document -- opens the same form in a
          sheet, same pattern as the estimate builder and credential card. */}
      <Button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="w-full md:hidden"
      >
        Sign as contractor
      </Button>
      <MobileSheet open={mobileOpen} onClose={() => setMobileOpen(false)} title="Sign as contractor">
        <form action={formAction} className="flex flex-col gap-4">
          {description}
          {fields}
        </form>
      </MobileSheet>
    </>
  );
}

// Shown on an executed version that has no rendered PDF yet -- either the
// render is still in flight, the automatic publish at signing time
// failed, or the version executed before PDF rendering existed. Queues
// (or re-queues) the render; safe to repeat.
export function GeneratePdfButton({
  versionId,
  estimateId,
}: {
  versionId: string;
  estimateId: string;
}) {
  const [state, formAction, pending] = useActionState(
    requestChangeOrderPdf.bind(null, versionId, estimateId),
    null,
  );

  return (
    <div className="flex flex-col gap-1">
      {state && state.error === null ? (
        <p className="text-sm text-muted-foreground">
          PDF queued — it will appear here shortly. Refresh the page.
        </p>
      ) : (
        <form action={formAction}>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "Queuing..." : "Generate PDF"}
          </Button>
        </form>
      )}
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </div>
  );
}

// Shown while a version awaits the client. Raw tokens are never stored,
// so the only way to recover a lost link is to mint a new one (which
// revokes the old).
export function SigningLinkPanel({
  versionId,
  estimateId,
}: {
  versionId: string;
  estimateId: string;
}) {
  const [state, formAction, pending] = useActionState(
    regenerateSigningLink.bind(null, versionId, estimateId),
    null,
  );

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Awaiting client signature</h2>
        <p className="text-sm text-muted-foreground">
          Send your client the signing link. Lost it? Generate a new one — the
          old link stops working.
        </p>
      </div>
      {state?.signingUrl ? (
        <CopyableLink url={state.signingUrl} emailedTo={state.emailedTo} />
      ) : (
        <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1.5 sm:max-w-sm">
            <Label htmlFor="regen_client_email">Client email (optional)</Label>
            <Input
              id="regen_client_email"
              name="client_email"
              type="email"
              placeholder="Sends them the new link"
            />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "Generating..." : "Generate new signing link"}
          </Button>
        </form>
      )}
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </div>
  );
}
