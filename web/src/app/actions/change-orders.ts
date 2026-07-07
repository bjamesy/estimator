"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  publishRenderChangeOrderPdfTask,
  publishSendSigningRequestEmailTask,
} from "@/lib/celery";
import { tryGetCurrentCompanyId } from "@/lib/company";
import {
  generateSigningToken,
  hashSigningToken,
  signingTokenExpiry,
} from "@/lib/signatures";
import { createClient } from "@/lib/supabase/server";

const POSTGRES_UNIQUE_VIOLATION = "23505";

// Numeric fields round-trip Postgres numeric -> JSON number; compare with
// the same tolerance the estimate-seeding price comparison uses rather
// than trusting float equality.
const NUMERIC_EPSILON = 0.0001;

type DraftLine = {
  id: string;
  source_line_item_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  markup_percent: number;
  total: number;
  price_verified_at: string | null;
};

type VersionLine = {
  source_estimate_line_id: string | null;
  source_line_item_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  markup_percent: number;
  total: number;
  price_verified_at: string | null;
  change_kind: string;
};

function linesEqual(draft: DraftLine, parent: VersionLine): boolean {
  return (
    draft.description === parent.description &&
    Math.abs(draft.quantity - parent.quantity) < NUMERIC_EPSILON &&
    Math.abs(draft.unit_price - parent.unit_price) < NUMERIC_EPSILON &&
    Math.abs(draft.markup_percent - parent.markup_percent) < NUMERIC_EPSILON
  );
}

// Same rationale as assertEstimateOwnership in estimates.ts (module-private
// there): estimate_versions' RLS policy only validates the new row's own
// company_id, not the estimate_id it references, and this is a plain
// exported Server Action invocable directly.
async function assertEstimateOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  estimateId: string,
  companyId: string,
): Promise<string | null> {
  const { data: estimate } = await supabase
    .from("estimates")
    .select("id")
    .eq("id", estimateId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!estimate) {
    return "Estimate not found.";
  }
  return null;
}

// Freezes the estimate's current active draft lines into a new immutable
// EstimateVersion (see 0016_estimate_versions.sql and
// docs/v2/plans/01-change-orders-plan.md -> Phase 1).
//
// - Each frozen line gets a change_kind computed against the previous
//   version, keyed on which draft line it came from
//   (source_estimate_line_id) -- not on description matching. Lines
//   present in the parent but gone from the draft are carried into the
//   new version as 'removed' rows (self-contained change order), excluded
//   from its total.
// - The root version (version 1) is the baseline: every line 'unchanged',
//   pct_change_from_root null.
// - A snapshot with no changes vs. the latest version is refused.
// - A previous version that never reached 'executed' is marked
//   'superseded'; executed versions are never touched -- they happened.
//
// Redirects to the new version's page on success; returns { error } on
// failure (bind as a form action with useActionState).
export async function snapshotEstimateVersion(
  estimateId: string,
  _prevState: unknown,
  _formData: FormData,
): Promise<{ error: string }> {
  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();

  const ownershipError = await assertEstimateOwnership(supabase, estimateId, companyId);
  if (ownershipError) {
    return { error: ownershipError };
  }

  // Active draft lines only -- tombstoned (deleted_at set) lines are
  // "removed from the draft" and will diff as 'removed' if the parent
  // version had them.
  const { data: draftData } = await supabase
    .from("estimate_lines")
    .select(
      "id, source_line_item_id, description, quantity, unit_price, markup_percent, total, price_verified_at",
    )
    .eq("estimate_id", estimateId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  const draftLines: DraftLine[] = draftData ?? [];

  const { data: latestVersion } = await supabase
    .from("estimate_versions")
    .select("id, version_number, status, total")
    .eq("estimate_id", estimateId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestVersion && draftLines.length === 0) {
    return { error: "Nothing to snapshot — the estimate has no lines." };
  }

  // The parent's baseline is its non-removed lines: a 'removed' row in
  // the parent recorded a removal that already happened at that version,
  // not content this snapshot should diff against.
  let parentLines: VersionLine[] = [];
  if (latestVersion) {
    const { data: parentData } = await supabase
      .from("estimate_version_lines")
      .select(
        "source_estimate_line_id, source_line_item_id, description, quantity, unit_price, markup_percent, total, price_verified_at, change_kind",
      )
      .eq("estimate_version_id", latestVersion.id)
      .neq("change_kind", "removed")
      .order("created_at", { ascending: true });
    parentLines = parentData ?? [];
  }

  const parentBySource = new Map(
    parentLines
      .filter((l) => l.source_estimate_line_id !== null)
      .map((l) => [l.source_estimate_line_id as string, l]),
  );

  const newLines: (Omit<VersionLine, "change_kind"> & {
    change_kind: "unchanged" | "added" | "modified" | "removed";
  })[] = [];

  for (const draft of draftLines) {
    const parent = latestVersion ? parentBySource.get(draft.id) : undefined;
    const change_kind = !latestVersion
      ? "unchanged" // root version is the baseline
      : !parent
        ? "added"
        : linesEqual(draft, parent)
          ? "unchanged"
          : "modified";
    newLines.push({
      source_estimate_line_id: draft.id,
      source_line_item_id: draft.source_line_item_id,
      description: draft.description,
      quantity: draft.quantity,
      unit_price: draft.unit_price,
      markup_percent: draft.markup_percent,
      total: draft.total,
      // "Price verified on [date]" stamp travels with the frozen line
      // into the version and its PDF (vendor price check audit trail).
      price_verified_at: draft.price_verified_at,
      change_kind,
    });
  }

  // Parent lines with no surviving draft line become 'removed' rows,
  // carrying the parent's frozen values.
  const draftIds = new Set(draftLines.map((l) => l.id));
  for (const parent of parentLines) {
    const stillPresent =
      parent.source_estimate_line_id !== null && draftIds.has(parent.source_estimate_line_id);
    if (!stillPresent) {
      newLines.push({
        source_estimate_line_id: parent.source_estimate_line_id,
        source_line_item_id: parent.source_line_item_id,
        description: parent.description,
        quantity: parent.quantity,
        unit_price: parent.unit_price,
        markup_percent: parent.markup_percent,
        total: parent.total,
        price_verified_at: parent.price_verified_at,
        change_kind: "removed",
      });
    }
  }

  if (
    latestVersion &&
    newLines.every((l) => l.change_kind === "unchanged")
  ) {
    return { error: `No changes since version ${latestVersion.version_number}.` };
  }

  const total = newLines
    .filter((l) => l.change_kind !== "removed")
    .reduce((sum, l) => sum + l.total, 0);

  // % change is always measured against the root (version 1) -- that is
  // the estimate the client originally agreed to, which is what Ontario
  // CPA's 10% rule is relative to. Not the parent version.
  let pctChangeFromRoot: number | null = null;
  if (latestVersion) {
    const { data: rootVersion } = await supabase
      .from("estimate_versions")
      .select("total")
      .eq("estimate_id", estimateId)
      .eq("version_number", 1)
      .single();
    if (rootVersion && rootVersion.total > 0) {
      pctChangeFromRoot = ((total - rootVersion.total) / rootVersion.total) * 100;
    }
  }

  const { data: version, error: versionError } = await supabase
    .from("estimate_versions")
    .insert({
      estimate_id: estimateId,
      company_id: companyId,
      parent_version_id: latestVersion?.id ?? null,
      version_number: (latestVersion?.version_number ?? 0) + 1,
      status: "draft",
      total,
      pct_change_from_root: pctChangeFromRoot,
    })
    .select("id")
    .single();

  if (versionError?.code === POSTGRES_UNIQUE_VIOLATION) {
    return { error: "A snapshot was just taken by another request — refresh and try again." };
  }
  if (versionError) {
    return { error: versionError.message };
  }

  const { error: linesError } = await supabase.from("estimate_version_lines").insert(
    newLines.map((l) => ({
      estimate_version_id: version.id,
      company_id: companyId,
      ...l,
    })),
  );

  if (linesError) {
    // A version row without its lines is a corrupt artifact -- best-effort
    // roll it back (it has no children yet, so RESTRICT doesn't block).
    await supabase.from("estimate_versions").delete().eq("id", version.id);
    return { error: `Failed to snapshot lines: ${linesError.message}` };
  }

  // Supersede the previous version if it never reached executed, and
  // revoke any unused signing tokens pointing at it -- the signing page's
  // status gate already refuses them, but a dead link shouldn't linger
  // as a live row either.
  if (latestVersion && latestVersion.status !== "executed") {
    await supabase
      .from("estimate_versions")
      .update({ status: "superseded" })
      .eq("id", latestVersion.id);
    await supabase
      .from("client_signing_tokens")
      .delete()
      .eq("estimate_version_id", latestVersion.id)
      .is("used_at", null);
  }

  revalidatePath(`/estimates/${estimateId}`);
  redirect(`/estimates/${estimateId}/versions/${version.id}`);
}

// Best-effort audit metadata from request headers (spec: "IP/device
// metadata optional") -- a proxy may strip either, so both are nullable.
async function requestAuditMetadata(): Promise<{
  ip_address: string | null;
  user_agent: string | null;
}> {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  return {
    ip_address: forwardedFor?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
    user_agent: h.get("user-agent"),
  };
}

// The signing URL is built from the request's own host so it works in
// any environment without a configured site-URL env var.
async function buildSigningUrl(rawToken: string): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host");
  return `${proto}://${host}/sign/${rawToken}`;
}

// Mints a fresh client signing token for a version, revoking any unused
// prior tokens (a version has at most one live link; a lost link is
// replaced, not resurrected -- the raw token is never stored, only its
// hash, so it *can't* be resurrected). Returns the full signing URL,
// which is shown to the contractor exactly once per mint.
async function mintSigningToken(
  supabase: Awaited<ReturnType<typeof createClient>>,
  versionId: string,
  companyId: string,
  clientEmail: string | null,
): Promise<{ signingUrl: string; emailedTo?: string } | { error: string }> {
  await supabase
    .from("client_signing_tokens")
    .delete()
    .eq("estimate_version_id", versionId)
    .is("used_at", null);

  const rawToken = generateSigningToken();
  const { error } = await supabase.from("client_signing_tokens").insert({
    estimate_version_id: versionId,
    company_id: companyId,
    token_hash: hashSigningToken(rawToken),
    client_email: clientEmail,
    expires_at: signingTokenExpiry().toISOString(),
  });
  if (error) {
    return { error: error.message };
  }
  const signingUrl = await buildSigningUrl(rawToken);

  // Email the client their link (Phase 5). Best-effort: the URL is
  // always also returned for the contractor to copy, so a broker hiccup
  // degrades to the manual handoff rather than losing the link.
  let emailedTo: string | undefined;
  if (clientEmail) {
    try {
      await publishSendSigningRequestEmailTask(versionId, companyId, clientEmail, signingUrl);
      emailedTo = clientEmail;
    } catch {
      // fall through -- contractor still gets the copyable link
    }
  }
  return { signingUrl, emailedTo };
}

type SignContractorState = {
  error: string | null;
  signingUrl?: string;
  emailedTo?: string;
};

// Contractor signs a draft version: records the signature (immutable --
// estimate_signatures has no update/delete policies), advances the
// lifecycle to pending_client_signature, and mints the client signing
// link. v1 capture is a typed full name adopted as the signature; the
// capture mechanism is isolated behind web/src/lib/signatures.ts so a
// certified e-signature provider can replace it without touching this
// state machine. See docs/v2/plans/01-change-orders-plan.md -> Phase 3.
export async function signVersionAsContractor(
  versionId: string,
  estimateId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<SignContractorState> {
  const signerName = (formData.get("signer_name") as string)?.trim();
  const clientEmail = (formData.get("client_email") as string)?.trim() || null;
  const consent = formData.get("consent") === "on";
  if (!signerName) {
    return { error: "Type your full name to sign." };
  }
  if (!consent) {
    return { error: "You must confirm the statement to sign." };
  }

  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();

  const { data: version } = await supabase
    .from("estimate_versions")
    .select("id, status")
    .eq("id", versionId)
    .eq("estimate_id", estimateId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!version) {
    return { error: "Version not found." };
  }
  if (version.status !== "draft") {
    return { error: "Only a draft version can be signed. This one is already in signing or superseded." };
  }

  const audit = await requestAuditMetadata();
  const { error: signatureError } = await supabase.from("estimate_signatures").insert({
    estimate_version_id: versionId,
    company_id: companyId,
    signer_role: "contractor",
    signer_name: signerName,
    signature_data: signerName,
    ...audit,
  });
  if (signatureError?.code === POSTGRES_UNIQUE_VIOLATION) {
    return { error: "This version already has a contractor signature." };
  }
  if (signatureError) {
    return { error: signatureError.message };
  }

  // Signature row is in (and can no longer be altered); advance the
  // lifecycle. If this update failed the signature would still stand,
  // which is the right failure order for a legal artifact.
  const { error: statusError } = await supabase
    .from("estimate_versions")
    .update({
      status: "pending_client_signature",
      contractor_signed_at: new Date().toISOString(),
    })
    .eq("id", versionId)
    .eq("status", "draft");
  if (statusError) {
    return { error: statusError.message };
  }

  const minted = await mintSigningToken(supabase, versionId, companyId, clientEmail);
  // Deliberately NO revalidatePath here: revalidating this page (or a
  // parent segment) re-renders the server tree, which swaps this form
  // out for SigningLinkPanel and unmounts the client state holding the
  // one-time signing URL before the contractor can copy it (observed
  // live). The page shows the fresh status on the next navigation; the
  // link display wins now.
  if ("error" in minted) {
    return { error: `Signed, but couldn't create the client link: ${minted.error}` };
  }
  return { error: null, signingUrl: minted.signingUrl, emailedTo: minted.emailedTo };
}

// Regenerates the client signing link for a version awaiting the client
// -- the only way to recover a link, since raw tokens are never stored.
// Revokes any prior unused link as a side effect (see mintSigningToken).
export async function regenerateSigningLink(
  versionId: string,
  estimateId: string,
  _prevState: unknown,
  formData: FormData,
): Promise<SignContractorState> {
  const clientEmail = (formData.get("client_email") as string)?.trim() || null;

  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();

  const { data: version } = await supabase
    .from("estimate_versions")
    .select("id, status")
    .eq("id", versionId)
    .eq("estimate_id", estimateId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!version) {
    return { error: "Version not found." };
  }
  if (version.status !== "pending_client_signature") {
    return { error: "This version isn't awaiting a client signature." };
  }

  const minted = await mintSigningToken(supabase, versionId, companyId, clientEmail);
  if ("error" in minted) {
    return { error: minted.error };
  }
  return { error: null, signingUrl: minted.signingUrl, emailedTo: minted.emailedTo };
}

// Manual (re-)publish of the legal PDF render for an executed version --
// the recovery path when the automatic publish at client-signing time
// failed (broker hiccup), and the backfill path for versions executed
// before Phase 4 existed. Safe to repeat: the worker task upserts an
// identical, deterministically-rendered object.
export async function requestChangeOrderPdf(
  versionId: string,
  estimateId: string,
  _prevState: unknown,
  _formData: FormData,
): Promise<{ error: string | null }> {
  const { companyId, error: companyError } = await tryGetCurrentCompanyId();
  if (companyError !== null) {
    return { error: companyError };
  }
  const supabase = await createClient();

  const { data: version } = await supabase
    .from("estimate_versions")
    .select("id, status")
    .eq("id", versionId)
    .eq("estimate_id", estimateId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!version) {
    return { error: "Version not found." };
  }
  if (version.status !== "executed") {
    return { error: "Only an executed version has a PDF — sign it first." };
  }

  try {
    await publishRenderChangeOrderPdfTask(versionId, companyId);
  } catch (exc) {
    return { error: `Couldn't queue the PDF render: ${exc instanceof Error ? exc.message : "unknown error"}` };
  }
  revalidatePath(`/estimates/${estimateId}/versions/${versionId}`);
  return { error: null };
}
