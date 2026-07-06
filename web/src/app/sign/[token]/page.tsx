import { CheckCircle2Icon } from "lucide-react";

import {
  CpaCallout,
  SignatureBlock,
  VersionLinesTable,
  VersionTotals,
  type Signature,
  type VersionLine,
} from "@/components/change-order/change-order-view";
import { hashSigningToken } from "@/lib/signatures";
import { createAdminClient } from "@/lib/supabase/admin";

import { ClientSignForm } from "./client-sign-form";

// PUBLIC PAGE -- the client-facing change-order signing surface, reached
// by the tokenized link the contractor sends. No session exists here:
// the token in the URL is the entire authorization, so all data access
// goes through the admin client, keyed strictly off the token row. See
// docs/v2/plans/01-change-orders-plan.md -> Phase 3 and
// 0017_signatures.sql.
//
// Every lookup happens per-request (the token's validity changes over
// time), so this page must never be statically cached.
export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <p className="text-sm font-semibold text-primary">Estimator</p>
      {children}
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <div className="flex flex-col gap-1 rounded-lg border p-6">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </Shell>
  );
}

export default async function ClientSigningPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: rawToken } = await params;
  const admin = createAdminClient();

  const { data: token } = await admin
    .from("client_signing_tokens")
    .select("id, estimate_version_id, expires_at, used_at")
    .eq("token_hash", hashSigningToken(rawToken))
    .maybeSingle();

  // One generic notice for unknown tokens -- don't reveal whether a
  // guessed token ever existed.
  if (!token) {
    return (
      <Notice
        title="This signing link is not valid"
        body="Check that the link was copied completely, or ask your contractor to send a new one."
      />
    );
  }

  const { data: version } = await admin
    .from("estimate_versions")
    .select(
      "id, estimate_id, version_number, status, total, pct_change_from_root, pdf_storage_path, estimates(name, companies(name))",
    )
    .eq("id", token.estimate_version_id)
    .single();

  if (!version) {
    return (
      <Notice
        title="This signing link is not valid"
        body="Ask your contractor to send a new one."
      />
    );
  }

  const estimate = version.estimates as unknown as {
    name: string;
    companies: { name: string } | null;
  } | null;
  const estimateName = estimate?.name ?? "Estimate";
  const companyName = estimate?.companies?.name ?? "Your contractor";

  const { data: linesData } = await admin
    .from("estimate_version_lines")
    .select("id, description, quantity, unit_price, markup_percent, total, change_kind")
    .eq("estimate_version_id", version.id)
    .order("created_at", { ascending: true });
  const lines: VersionLine[] = linesData ?? [];

  const { data: signaturesData } = await admin
    .from("estimate_signatures")
    .select("signer_role, signer_name, signature_data, signed_at")
    .eq("estimate_version_id", version.id)
    .order("signed_at", { ascending: true });
  const signatures: Signature[] = signaturesData ?? [];
  const contractorSignature = signatures.find((s) => s.signer_role === "contractor");
  const clientSignature = signatures.find((s) => s.signer_role === "client");

  const isRoot = version.version_number === 1;
  let rootTotal: number | null = null;
  if (!isRoot) {
    const { data: root } = await admin
      .from("estimate_versions")
      .select("total")
      .eq("estimate_id", version.estimate_id)
      .eq("version_number", 1)
      .maybeSingle();
    rootTotal = root?.total ?? null;
  }

  const pct = version.pct_change_from_root;

  const review = (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {isRoot ? "Estimate" : "Change order"} — {estimateName}
        </h1>
        <p className="text-sm text-muted-foreground">
          From {companyName} · Version {version.version_number}
        </p>
      </div>
      {pct !== null && pct >= 10 && (
        <CpaCallout pct={pct} forClient executed={version.status === "executed"} />
      )}
      <VersionTotals rootTotal={rootTotal} versionTotal={version.total} pct={pct} />
      <VersionLinesTable lines={lines} versionTotal={version.total} />
    </>
  );

  // Fully executed: this page becomes the client's receipt, whether they
  // arrive back via the same (now used) link or just after signing. If
  // the legal PDF has been rendered, offer it for download (signed URL
  // via the admin client -- the client has no storage identity).
  if (version.status === "executed") {
    let pdfUrl: string | null = null;
    if (version.pdf_storage_path) {
      const { data: signed } = await admin.storage
        .from("documents")
        .createSignedUrl(version.pdf_storage_path, 60 * 60);
      pdfUrl = signed?.signedUrl ?? null;
    }
    return (
      <Shell>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm font-medium text-emerald-800 dark:text-emerald-300">
          <span className="flex items-center gap-2">
            <CheckCircle2Icon className="size-5 shrink-0" />
            This {isRoot ? "estimate" : "change order"} has been signed by both parties.
          </span>
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto rounded-lg border border-emerald-600/40 px-2.5 py-1 text-xs font-medium hover:bg-emerald-500/20"
            >
              Download PDF
            </a>
          )}
        </div>
        {review}
        <div className="grid gap-3 sm:grid-cols-2">
          {contractorSignature && <SignatureBlock signature={contractorSignature} />}
          {clientSignature && <SignatureBlock signature={clientSignature} />}
        </div>
      </Shell>
    );
  }

  if (version.status !== "pending_client_signature") {
    return (
      <Notice
        title="This change order is no longer awaiting a signature"
        body="It may have been replaced by a newer version. Ask your contractor for the latest one."
      />
    );
  }

  if (token.used_at !== null) {
    return (
      <Notice
        title="This signing link has already been used"
        body="Ask your contractor to send a new link if you still need to sign."
      />
    );
  }

  if (new Date(token.expires_at) < new Date()) {
    return (
      <Notice
        title="This signing link has expired"
        body="Ask your contractor to send a new one."
      />
    );
  }

  return (
    <Shell>
      {review}
      {contractorSignature && (
        <div className="grid gap-3 sm:grid-cols-2">
          <SignatureBlock signature={contractorSignature} />
        </div>
      )}
      <ClientSignForm token={rawToken} />
    </Shell>
  );
}
