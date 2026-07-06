import { createClient } from "@/lib/supabase/server";

import { CredentialCard, type Credential } from "./credential-card";

// Contractor credential verification, V1 "document-on-file" -- see
// docs/v2/plans/02-verification-plan.md. One active credential per type;
// uploads supersede (history retained), fields auto-extracted by the
// worker and correctable here. Status reflects submitted documents, not
// an independent guarantee (that's the V2 WSIB cross-check).
const CREDENTIAL_SECTIONS = [
  {
    type: "wsib" as const,
    title: "WSIB clearance",
    description:
      "Workplace Safety and Insurance Board clearance certificate — shows your workers are covered.",
  },
  {
    type: "liability_insurance" as const,
    title: "Liability insurance",
    description:
      "Commercial general liability certificate — clients commonly expect $2M coverage.",
  },
  {
    type: "business_registration" as const,
    title: "Business registration",
    description: "Business registration or corporate good-standing document (optional).",
  },
];

export default async function CredentialsPage() {
  const supabase = await createClient();

  const { data: credentialsData } = await supabase
    .from("credentials")
    .select(
      "id, credential_type, status, issued_date, expiry_date, coverage_amount, provider, last_checked_at, created_at",
    )
    .is("superseded_at", null);
  const active = new Map<string, Credential>(
    (credentialsData ?? []).map((c) => [c.credential_type, c]),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Credentials</h1>
        <p className="text-sm text-muted-foreground">
          Keep your certificates on file and current. Key fields are read
          automatically from each upload — correct them if the reading is wrong.
          You&apos;ll be reminded before anything expires.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {CREDENTIAL_SECTIONS.map((section) => (
          <CredentialCard
            key={section.type}
            type={section.type}
            title={section.title}
            description={section.description}
            credential={active.get(section.type) ?? null}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Status reflects the documents you&apos;ve submitted — it is not an independent
        verification of standing with WSIB, your insurer, or a registry.
      </p>
    </div>
  );
}
