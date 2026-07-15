"use client";

import { PencilIcon } from "lucide-react";
import { useActionState, useRef, useState } from "react";

import { updateCredentialFields, uploadCredential } from "@/app/actions/credentials";
import type { CredentialType } from "@/lib/credential-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MobileSheet } from "@/components/ui/mobile-sheet";

export type Credential = {
  id: string;
  credential_type: string;
  status: string;
  issued_date: string | null;
  expiry_date: string | null;
  coverage_amount: number | null;
  provider: string | null;
  last_checked_at: string | null;
  created_at: string;
};

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  self_reported: {
    label: "On file",
    className: "border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  verified: {
    label: "Verified",
    className: "border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  expired: {
    label: "Expired",
    className: "border-transparent bg-destructive/10 text-destructive",
  },
};

export function daysUntil(dateString: string): number {
  return Math.ceil((new Date(dateString).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function UploadForm({ type, replace }: { type: CredentialType; replace: boolean }) {
  const [state, formAction, pending] = useActionState(
    uploadCredential.bind(null, type),
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-1">
      {/* Auto-submit on file pick, same pattern as document upload. */}
      <input
        ref={inputRef}
        type="file"
        name="file"
        accept=".pdf,.jpg,.jpeg,.png,.heic,.heif"
        className="hidden"
        onChange={() => formRef.current?.requestSubmit()}
      />
      <Button
        type="button"
        size="sm"
        variant={replace ? "outline" : "default"}
        disabled={pending}
        onClick={() => inputRef.current?.click()}
      >
        {pending ? "Uploading..." : replace ? "Upload renewal" : "Upload certificate"}
      </Button>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

// Read-only stand-in for FieldsForm on mobile -- only the fields that are
// actually set, so an unpopulated credential doesn't show a row of dashes.
function CredentialSummary({ credential }: { credential: Credential }) {
  const parts = [
    credential.issued_date && `Issued ${credential.issued_date}`,
    credential.expiry_date && `Expires ${credential.expiry_date}`,
    credential.provider,
    credential.coverage_amount !== null && `$${credential.coverage_amount.toLocaleString()}`,
  ].filter(Boolean);

  return (
    <span className="min-w-0 truncate text-sm text-muted-foreground">
      {parts.length > 0 ? parts.join(" · ") : "No details entered yet"}
    </span>
  );
}

function FieldsForm({ credential }: { credential: Credential }) {
  const [state, formAction, pending] = useActionState(
    updateCredentialFields.bind(null, credential.id),
    null,
  );

  return (
    <form
      action={formAction}
      className="grid grid-cols-2 items-end gap-2 sm:grid-cols-5"
      // Remount on fresh server data so defaultValues update after
      // extraction lands (same keying idea as estimate line rows).
      key={`${credential.id}-${credential.last_checked_at}`}
    >
      {/* Nested label, no id/htmlFor -- this form renders twice at once
          (desktop copy stays mounted-but-hidden below md while the mobile
          sheet's copy is open), so a shared id would collide and break
          label association; nesting sidesteps that entirely. */}
      <label className="flex flex-col gap-1 text-xs">
        Issued
        <Input name="issued_date" type="date" defaultValue={credential.issued_date ?? ""} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Expires
        <Input name="expiry_date" type="date" defaultValue={credential.expiry_date ?? ""} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Provider
        <Input name="provider" defaultValue={credential.provider ?? ""} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Coverage ($)
        <Input
          name="coverage_amount"
          type="number"
          step="any"
          defaultValue={credential.coverage_amount ?? ""}
        />
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </Button>
      {state?.error && (
        <p className="col-span-full text-sm text-destructive">{state.error}</p>
      )}
    </form>
  );
}

export function CredentialCard({
  type,
  title,
  description,
  credential,
}: {
  type: CredentialType;
  title: string;
  description: string;
  credential: Credential | null;
}) {
  const badge = credential ? STATUS_BADGES[credential.status] : null;
  const daysLeft = credential?.expiry_date ? daysUntil(credential.expiry_date) : null;
  const extracting = credential !== null && credential.last_checked_at === null;
  const [editOpen, setEditOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col">
          <span className="flex items-center gap-2 font-semibold">
            {title}
            {badge && <Badge className={badge.className}>{badge.label}</Badge>}
            {daysLeft !== null && daysLeft >= 0 && daysLeft <= 30 && (
              <Badge className="border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-400">
                Expires in {daysLeft} day{daysLeft === 1 ? "" : "s"}
              </Badge>
            )}
          </span>
          <span className="text-sm text-muted-foreground">{description}</span>
        </div>
        <div className="ml-auto">
          <UploadForm type={type} replace={credential !== null} />
        </div>
      </div>
      {extracting && (
        <p className="text-sm text-muted-foreground">
          Reading the certificate… fields will fill in automatically — refresh in a
          moment, or enter them yourself below.
        </p>
      )}
      {credential && (
        <>
          {/* Desktop: fields inline, as before. */}
          <div className="hidden md:block">
            <FieldsForm credential={credential} />
          </div>

          {/* Mobile: a compact read-only summary + a button that opens the
              same form in a sheet, instead of a 4-field grid always sitting
              open on the card (of which there are 3 stacked on this page). */}
          <div className="flex items-center justify-between gap-3 md:hidden">
            <CredentialSummary credential={credential} />
            <Button type="button" size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <PencilIcon className="size-3.5" />
              Edit details
            </Button>
          </div>
          <MobileSheet open={editOpen} onClose={() => setEditOpen(false)} title={title}>
            <FieldsForm credential={credential} />
          </MobileSheet>
        </>
      )}
      {!credential && (
        <p className="text-sm text-muted-foreground">Nothing on file yet.</p>
      )}
    </div>
  );
}
