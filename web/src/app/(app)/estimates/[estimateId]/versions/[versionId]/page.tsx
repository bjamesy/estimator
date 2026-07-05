import { ArrowLeftIcon, CheckCircle2Icon, FileDownIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  CpaCallout,
  SignatureBlock,
  VersionLinesTable,
  VersionTotals,
  type Signature,
  type VersionLine,
} from "@/components/change-order/change-order-view";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";

import { GeneratePdfButton, SignContractorForm, SigningLinkPanel } from "./signature-section";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_contractor_signature: "Awaiting your signature",
  pending_client_signature: "Awaiting client signature",
  executed: "Executed",
  superseded: "Superseded",
};

export default async function EstimateVersionPage({
  params,
}: {
  params: Promise<{ estimateId: string; versionId: string }>;
}) {
  const { estimateId, versionId } = await params;
  const supabase = await createClient();

  const { data: version } = await supabase
    .from("estimate_versions")
    .select(
      "id, version_number, status, total, pct_change_from_root, created_at, contractor_signed_at, client_signed_at, pdf_storage_path, estimates(name)",
    )
    .eq("id", versionId)
    .eq("estimate_id", estimateId)
    .single();

  if (!version) {
    notFound();
  }

  const estimateName =
    (version.estimates as unknown as { name: string } | null)?.name ?? "Estimate";

  const { data: linesData } = await supabase
    .from("estimate_version_lines")
    .select("id, description, quantity, unit_price, markup_percent, total, change_kind")
    .eq("estimate_version_id", versionId)
    .order("created_at", { ascending: true });
  const lines: VersionLine[] = linesData ?? [];

  const { data: signaturesData } = await supabase
    .from("estimate_signatures")
    .select("signer_role, signer_name, signature_data, signed_at")
    .eq("estimate_version_id", versionId)
    .order("signed_at", { ascending: true });
  const signatures: Signature[] = signaturesData ?? [];
  const contractorSignature = signatures.find((s) => s.signer_role === "contractor");
  const clientSignature = signatures.find((s) => s.signer_role === "client");

  // The original (version 1) total -- what the client first agreed to,
  // and what Ontario CPA's 10% rule measures against.
  const isRoot = version.version_number === 1;
  let rootTotal: number | null = null;
  if (!isRoot) {
    const { data: root } = await supabase
      .from("estimate_versions")
      .select("total")
      .eq("estimate_id", estimateId)
      .eq("version_number", 1)
      .single();
    rootTotal = root?.total ?? null;
  }

  const pct = version.pct_change_from_root;

  // The rendered legal PDF (Phase 4). Signed URL is short-lived and
  // per-render; the storage object sits under the company prefix, so the
  // 0005 storage policy scopes it like any original document.
  let pdfUrl: string | null = null;
  if (version.status === "executed" && version.pdf_storage_path) {
    const { data: signed } = await supabase.storage
      .from("documents")
      .createSignedUrl(version.pdf_storage_path, 60 * 60);
    pdfUrl = signed?.signedUrl ?? null;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/estimates/${estimateId}`}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          {estimateName}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {estimateName} — Version {version.version_number}
          </h1>
          <Badge variant="outline">{STATUS_LABELS[version.status] ?? version.status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Snapshotted {new Date(version.created_at).toLocaleDateString()}. Versions are
          read-only — edit the estimate and snapshot again to make changes.
        </p>
      </div>

      {pct !== null && pct >= 10 && <CpaCallout pct={pct} />}

      <VersionTotals rootTotal={rootTotal} versionTotal={version.total} pct={pct} />

      <VersionLinesTable lines={lines} versionTotal={version.total} />

      {/* Signing lifecycle (docs/v2/plans/01-change-orders-plan.md ->
          Phase 3): draft -> contractor signs -> pending_client_signature
          -> client signs via tokenized public link -> executed. A
          superseded version shows its signatures (if any) but offers no
          signing actions. */}
      {version.status === "executed" && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm font-medium text-emerald-800 dark:text-emerald-300">
          <span className="flex items-center gap-2">
            <CheckCircle2Icon className="size-5 shrink-0" />
            Executed — signed by both parties. This document and its signatures are locked.
          </span>
          <span className="ml-auto">
            {pdfUrl ? (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-emerald-600/40 px-2.5 py-1 text-xs font-medium hover:bg-emerald-500/20"
              >
                <FileDownIcon className="size-3.5" />
                Download PDF
              </a>
            ) : (
              <GeneratePdfButton versionId={versionId} estimateId={estimateId} />
            )}
          </span>
        </div>
      )}

      {(contractorSignature || clientSignature) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {contractorSignature && <SignatureBlock signature={contractorSignature} />}
          {clientSignature && <SignatureBlock signature={clientSignature} />}
        </div>
      )}

      {version.status === "draft" && (
        <SignContractorForm versionId={versionId} estimateId={estimateId} />
      )}

      {version.status === "pending_client_signature" && (
        <SigningLinkPanel versionId={versionId} estimateId={estimateId} />
      )}
    </div>
  );
}
