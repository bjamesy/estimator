# Implementation Plan: Contractor Credential Verification

Spec: `../02-contractor-verification.md`. Priority **2 of 3** in focus.

Contractors upload WSIB clearance, liability insurance, and business-registration
certificates. The system stores them, extracts key fields (especially expiry dates)
by **reusing the existing extraction pipeline**, displays verification status, and
prompts re-upload before certs lapse.

## What exists today to build on

- The **extraction pipeline** (`workers/estimator_workers/`: `fetch → extract → parse`
  chain, `_run_stage` wrapper, `DocumentProcessingEvent` progress) already downloads a
  file from Supabase Storage, runs a Claude vision call, and writes structured JSON.
  Credential parsing is the same shape: upload a PDF/photo, extract fields, review.
- **Supabase Storage** + the upload discipline (SHA-256 idempotency, originals retained)
  in `web/src/app/actions/documents.ts` is directly reusable.
- The **classification** work (post-MVP `rejected` status) shows the extraction prompt
  already returns a `document_type` — the same mechanism can classify a cert type.
- **No contractor profile** entity exists yet — today the unit of identity is `Company`.
  Credentials attach to the company (or a per-company contractor profile, if/when the
  marketplace needs public-facing profiles — defer that shape until feature 03).
- **Email/reminder infra** does not exist yet — it's built in feature 01, Phase 5, and
  reused here for expiry reminders.

## Phase 1 — Credential storage & upload (V1: document-on-file)

**Goal:** contractor uploads a cert; it's stored and displayed as "submitted", with any
extractable fields captured.

Schema (`0019_credentials.sql`):

```
Credential
  id
  company_id             FK → Company
  credential_type        "wsib" | "liability_insurance" | "business_registration"
  storage_path           original cert in Supabase Storage (retained, like Documents)
  status                 "self_reported" | "verified" | "expired"
  issued_date            nullable
  expiry_date            nullable
  coverage_amount        numeric, nullable   (liability insurance — structured field)
  provider               text, nullable      (insurer name)
  extraction_result      jsonb, nullable     (raw extracted fields, like ExtractionResult)
  last_checked_at        timestamptz, nullable
  created_at
```

- Company-scoped RLS (copy `0004_rls_policies.sql` pattern). `ON DELETE RESTRICT` on the
  storage-backed record consistent with the retention discipline — though credentials
  are less "source of truth" than purchasing history, so a superseded/renewed cert can
  reasonably be soft-hidden rather than deleted (add `superseded_at` if renewal history
  matters; start without it).
- `coverage_amount` and `provider` are **structured fields** (spec §Data Model) so
  liability coverage can be displayed/filtered cleanly ("$2M, Verified") rather than
  living only inside a document.
- Reuse the upload flow: SHA-256 idempotency, `capture="environment"` photo option on
  touch devices — lift from `documents.ts` / `upload-form.tsx`.

Actions (`web/src/app/actions/credentials.ts`, new file):

- `uploadCredential(credentialType, file)` — stores original, creates `Credential`
  (`status = self_reported`), publishes an extraction task (Phase 2).
- `listCredentials()`, `deleteCredential(id)` (soft, if renewal history is kept).

## Phase 2 — Field extraction (reuse the pipeline)

**Goal:** auto-extract issue/expiry dates, coverage amount, provider — reusing the
vision LLM pipeline rather than building a second one.

- Add a credential-aware extraction path in `workers/`. Two options:
  - **(Recommended) A parallel task** `extract_credential(credential_id, company_id,
    storage_path)` that reuses `call_vision_llm` from `extraction.py` with a
    credential-specific prompt (cert type → fields to pull: issue date, expiry date,
    coverage amount, provider, policy/registration number). Writes results back onto the
    `Credential` row (or a `CredentialExtraction` table if you want the permanent raw
    record, mirroring `ExtractionResult`).
  - Avoid overloading the invoice `process_document` chain — credentials are a different
    schema and shouldn't flow through invoice promotion.
- Publish via a new `web/src/lib/celery.ts` wrapper (`publishExtractCredentialTask`),
  mirroring `publishMatchMaterialsTask`.
- Progress/UX: extraction is best-effort. If a field can't be read, the contractor fills
  it manually — never fabricate an expiry date (same honesty principle as dropping
  null-priced line items in `data_model.md` → LineItem). Show a lightweight review step
  so the contractor confirms/corrects the extracted expiry before it's trusted.

## Phase 3 — Verification status & profile display

**Goal:** show what's verified and as-of when, on a contractor-facing (and later
client-facing) surface.

- Company/contractor settings page section listing each credential with status, expiry,
  and structured details ("WSIB Clearance: Submitted (valid until [date])", "Liability
  Insurance: $2M, Submitted").
- A rollup "Verified" indicator once required credentials are on file. Be precise about
  language — **V1 is "submitted / document-on-file", not independently verified**
  (spec §Verification Levels). Display clearly that status reflects submitted documents,
  not a platform guarantee (spec §Out of Scope).
- Keep the client-facing profile view minimal here; the full public profile is feature
  03 (marketplace, backlogged). This phase just makes the data presentable internally.

## Phase 4 — Expiry tracking & reminders

**Goal:** track expiry dates; prompt re-upload before lapse; expire status on lapse.

- A scheduled sweep (reuse the reminder infra built in feature 01, Phase 5 — periodic
  Celery beat task or cron) that:
  - Sends re-upload reminders at 30 / 14 / 1 days before `expiry_date` (in-app + email).
  - Flips `status` to `expired` once `expiry_date` passes.
- Consider auto-hiding a "Verified" rollup while any required credential is expired,
  until renewed (spec §Notifications). Gate this behind the marketplace's public profile
  when that ships; internally, just show "Expired — renew".

## Phase 5 (optional / later) — V2 verified cross-check

**Goal:** move from "document-on-file" to independently verified.

- Research WSIB's public clearance lookup — whether it's programmatically queryable vs.
  manual. If available, cross-check the uploaded cert against WSIB's live status and
  upgrade `status` to `verified` with `last_checked_at`.
- Requires external-service research; treat as a distinct, later spike. Not required for
  the in-focus milestone.

## Out of scope (per spec)

- Platform legal liability for fraudulent credentials — display the "reflects submitted
  documents, not a guarantee" disclaimer prominently.

## Sequencing within this feature

1 → 2 → 3 → 4, with 5 as a later spike. Phase 1 (upload + storage) is shippable alone
and immediately useful. Phase 2 reuses the vision pipeline — the main new work is a
credential prompt + write-back. Phase 4 depends on feature 01's reminder/email infra;
if feature 02 somehow precedes 01, build a minimal cron here and refactor later.
