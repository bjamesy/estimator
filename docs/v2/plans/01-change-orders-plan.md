# Implementation Plan: Change Order & Compliance Documents

Spec: `../01-change-orders-compliance.md`. Priority **1 of 3** in focus.

This feature turns an estimate revision into a formal, versioned, dual-signed,
timestamped PDF tied to Ontario CPA's 10%-overage rule. It also lays the shared
foundations (versioning, signatures, PDF) reused by features 2 and 3.

## What exists today to build on

- `Estimate` / `EstimateLine` (`docs/data_model.md`) — estimates are editable drafts
  with **no lifecycle/status field** and no version history; edits mutate lines in
  place (soft-delete for removals). This is the biggest gap: change orders need
  immutable versions.
- `EstimateLine` is already a snapshot (`source_line_item_id` is provenance only), so
  freezing a revision is a copy operation, consistent with the system's snapshot
  pattern.
- No PDF rendering, no signature capture, no client-facing surface, no notifications
  exist yet.

## Phase 1 — Estimate versioning (immutable revisions)

**Goal:** an estimate can be "snapshotted" into an immutable version; further edits
create a new version linked to the prior one.

Schema (`0016_estimate_versions.sql`):

```
EstimateVersion
  id
  estimate_id            FK → Estimate            (root/live estimate)
  company_id             FK → Company
  parent_version_id      FK → EstimateVersion, nullable   (previous version; null = original)
  version_number         int, monotonic per estimate
  status                 "draft" | "pending_contractor_signature"
                         | "pending_client_signature" | "executed" | "superseded"
  subtotal               numeric      (sum of active line totals, frozen at snapshot)
  total                  numeric
  pct_change_from_root   numeric, nullable   (vs. version_number = 1 total; null on original)
  created_at
  contractor_signed_at   timestamptz, nullable
  client_signed_at       timestamptz, nullable
```

```
EstimateVersionLine
  id
  estimate_version_id    FK → EstimateVersion
  company_id             FK → Company
  source_line_item_id    FK → LineItem, nullable   (provenance, carried through)
  description
  quantity
  unit_price
  markup_percent
  total
  change_kind            "unchanged" | "added" | "modified" | "removed"   (vs. parent version)
  created_at
```

- `EstimateVersion` and `EstimateVersionLine` are **append-only / immutable** —
  `ON DELETE RESTRICT`, never updated after signing begins (status/signature
  timestamps are the only mutable columns, and only forward through the lifecycle).
  This mirrors the `Document → Invoice → LineItem` retention discipline.
- The live `Estimate`/`EstimateLine` tables stay as the **working draft**. Snapshotting
  copies the current active lines into a new `EstimateVersion` + lines.
- `change_kind` is computed at snapshot time by diffing the new active lines against
  the parent version's lines (match on `source_line_item_id` where present, else
  description). This drives the "new/changed line items highlighted" requirement.
- RLS policies scoped by `company_id` on both tables (copy the pattern from
  `0004_rls_policies.sql`).

Actions (`web/src/app/actions/change-orders.ts`, new file):

- `snapshotEstimateVersion(estimateId)` — freezes current active `EstimateLine`s into a
  new `EstimateVersion` (status `draft`), computes `version_number`,
  `pct_change_from_root`, and per-line `change_kind`. Guards: estimate belongs to
  caller's company; refuses to snapshot if the current draft equals the latest version.
- `listEstimateVersions(estimateId)` — version history for the UI.

## Phase 2 — CPA 10% threshold detection & change-order UI

**Goal:** surface the compliance signal and the versioned change document.

- On snapshot (and live, while editing), compute `pct_change_from_root`. When
  `total >= 1.10 × root_total`, flag prominently in the estimate editor **and** on the
  version — this is the CPA threshold requiring documented consent. Store the boolean
  or rely on the computed pct; render a persistent banner, not a toast.
- Change-order review page (`web/src/app/(app)/estimates/[estimateId]/versions/[versionId]/`):
  - Original (root) line items, read-only.
  - This version's lines with `change_kind` highlighting (added/modified/removed).
  - Old total, new total, % change, threshold callout.
  - Signature blocks (Phase 3).
- No worker involvement — this is all synchronous Next.js + Postgres.

## Phase 3 — Signatures & lifecycle

**Goal:** contractor signs, then client signs; signatures + timestamps lock to the
version; status advances through the lifecycle.

Decision (see roadmap cross-cutting #2, #3): **in-house signature capture for v1**,
with a clean seam to swap in a certified provider later. Clients have **no account** —
they sign via a tokenized link.

Schema (`0017_signatures.sql`):

```
EstimateSignature
  id
  estimate_version_id    FK → EstimateVersion
  company_id             FK → Company
  signer_role            "contractor" | "client"
  signer_name
  signer_email           nullable
  signature_image        storage path or data (drawn/typed signature)
  signed_at              timestamptz
  ip_address             nullable      (audit trail — spec: "IP/device metadata optional")
  user_agent             nullable
  created_at
```

```
ClientSigningToken
  id
  estimate_version_id    FK → EstimateVersion
  company_id             FK → Company
  token_hash             (store hash, not the raw token)
  expires_at
  used_at                nullable
  created_at
```

- Lifecycle transitions (contractor-side actions, RLS-scoped):
  `draft → pending_contractor_signature → pending_client_signature → executed`.
  A new snapshot supersedes an unexecuted prior version (`superseded`).
- `signContractor(versionId, signaturePayload)` — records the contractor signature,
  advances status, mints a `ClientSigningToken`, triggers client notification (Phase 5).
- **Client signing path** — a public route (`web/src/app/sign/[token]/`) outside the
  authed app shell. Validates the token (hash match, not expired, not used), renders a
  read-only change-order view + signature capture, records the client `EstimateSignature`,
  sets `client_signed_at`, advances status to `executed`, marks token `used_at`. Rate-
  limit and single-use enforced server-side. This is the one deliberate exception to
  "everything is behind auth" — scope it tightly.
- Once `executed`, the version and its signatures are **fully immutable**. Generate the
  final PDF (Phase 4) at this point and store it.
- **Provider seam:** isolate signature capture behind one module
  (`web/src/lib/signatures.ts`) so a DocuSign-class provider can replace in-house
  capture without touching the lifecycle/state machine.

## Phase 4 — PDF generation (the legal artifact)

**Goal:** render an executed change order to a stored PDF; structured data remains for
search/filter (spec: "PDF is the legal artifact, structured data is for search").

- Add PDF rendering. Decide sync-in-Next.js (e.g. a React-PDF/HTML-to-PDF lib) vs. a
  new `workers/` task. **Recommendation: a new Celery task** (`render_change_order_pdf`),
  consistent with keeping heavy/slow work off the request path and reusing the
  established publish pattern (`publishTask` in `web/src/lib/celery.ts`, new wrapper
  `publishRenderChangeOrderPdfTask`). The worker writes the PDF to Supabase Storage and
  records its path on the version.
- Store the rendered PDF path + enough structured data to deterministically regenerate
  it (spec §Data Model). Add `pdf_storage_path` to `EstimateVersion`
  (`0018_change_order_pdf.sql`).
- **Template is swappable and lawyer-supplied** (roadmap cross-cutting #1, confirmed by
  founder): the renderer takes template content as input; **no legal clauses are
  hardcoded**. Leave structured slots for: scope description, cost breakdown, both
  parties' identifying info, signature + date fields, statement of consent to the price
  change. Ship v1 with a clearly-marked placeholder template until the vetted one lands.

## Phase 5 — Notifications

- Client notification (email; SMS optional later) when a version awaits their signature
  — contains the tokenized signing link.
- Contractor notification when the client signs; reminder to client after 3–5 days if
  unsigned. Reminders imply a scheduled job — a periodic Celery beat task or a simple
  cron reading pending versions. Start with the send-on-event emails; add the reminder
  sweep second.
- No email infra exists yet — pick a provider (transactional email) as part of this
  phase; isolate behind one module so it's reusable by feature 2's expiry reminders.

## Out of scope (per spec)

- Automated legal enforcement / legal advice.
- Certified e-signature (DocuSign-level) — evaluate after v1 in-house capture.

## Sequencing within this feature

1 → 2 → 3 → 4 → 5. Phases 1–2 are pure schema + Next.js and independently shippable
(versioning + threshold detection are useful even before signatures). Phase 3 is the
largest (client-facing surface, tokens, state machine). Phase 4 depends on the vetted
template but can ship with a placeholder. Phase 5 needs email infra that feature 2 also
depends on — build it here, reuse there.
