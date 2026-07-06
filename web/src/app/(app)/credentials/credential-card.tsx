"use client";

import { useActionState, useRef } from "react";

import { updateCredentialFields, uploadCredential } from "@/app/actions/credentials";
import type { CredentialType } from "@/lib/credential-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

function daysUntil(dateString: string): number {
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
      <div className="flex flex-col gap-1">
        <Label htmlFor={`issued-${credential.id}`} className="text-xs">
          Issued
        </Label>
        <Input
          id={`issued-${credential.id}`}
          name="issued_date"
          type="date"
          defaultValue={credential.issued_date ?? ""}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`expiry-${credential.id}`} className="text-xs">
          Expires
        </Label>
        <Input
          id={`expiry-${credential.id}`}
          name="expiry_date"
          type="date"
          defaultValue={credential.expiry_date ?? ""}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`provider-${credential.id}`} className="text-xs">
          Provider
        </Label>
        <Input
          id={`provider-${credential.id}`}
          name="provider"
          defaultValue={credential.provider ?? ""}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`coverage-${credential.id}`} className="text-xs">
          Coverage ($)
        </Label>
        <Input
          id={`coverage-${credential.id}`}
          name="coverage_amount"
          type="number"
          step="any"
          defaultValue={credential.coverage_amount ?? ""}
        />
      </div>
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
      {credential && <FieldsForm credential={credential} />}
      {!credential && (
        <p className="text-sm text-muted-foreground">Nothing on file yet.</p>
      )}
    </div>
  );
}
