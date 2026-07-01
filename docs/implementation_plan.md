# Implementation Plan

**Status:** Approved 2026-06-30. Phases reflect the decisions in [architecture.md](./architecture.md) and [data_model.md](./data_model.md). Product scope is defined in [product-mvp.md](./product-mvp.md).

---

## Repo Structure

Monorepo with three top-level directories:

```
/
├── web/          Next.js app (TypeScript) — frontend and server-side API routes
├── workers/      Python + Celery worker service — extraction pipeline
└── database/     Schema migrations and seed data — shared source of truth
```

`database/` is the canonical home for all Postgres migrations. Both `web/` and `workers/` are consumers of that schema — neither owns migrations directly. Any schema change lands in `database/` first and both services are updated against it.

---

## Phases

### Phase 0 — Infra and Repo Setup

Stand up the foundation. Nothing user-facing.

**In scope:**
- Initialize monorepo with `web/`, `workers/`, `database/` directories
- Supabase project: Postgres instance, initial schema migration (see `data_model.md`), Row Level Security policies, Supabase Storage bucket for original documents
- RabbitMQ: managed instance (e.g. CloudAMQP)
- Auth: Supabase Auth configured for company/user management
- Next.js app scaffolding in `web/`
- Python + Celery worker scaffolding in `workers/` (Celery app configured, RabbitMQ broker connection, no tasks yet)
- Environment config: connection strings, API keys, Supabase anon/service keys

**Explicitly deferred:** all application features, all extraction logic.

---

### Phase 1 — Projects and Document Upload

Users can create projects and upload documents. Documents land in permanent storage. No extraction runs yet.

**In scope:**
- Project CRUD (create, list, view) — scoped to authenticated company
- File upload UI (PDF, JPEG, PNG)
- Next.js API route: receive upload → write original to Supabase Storage → create `Document` record with `status = pending`, `storage_path` recorded
- Document list view per project showing upload status
- RLS enforcement: all queries scoped by `company_id`

**Explicitly deferred:** extraction, Celery tasks, DocumentProcessingEvent, any display of extracted data.

**Milestone:** a user can create a project, upload a real invoice, and confirm the file is stored and the Document record exists.

---

### Phase 2 — Real Extraction, Informal

Call the vision LLM on an uploaded document and display the raw extracted result. Pipeline formalism (Celery chain, event log, retry semantics) is intentionally absent here — the goal is to see real invoice output and catch extraction quality issues before building the formal pipeline around it.

**In scope:**
- Next.js API route (or simple background call): fetch document from Supabase Storage → call vision LLM (e.g. GPT-4o or Claude) → parse structured JSON response → display in UI
- Extraction prompt: target schema matches `ExtractionResult.payload` shape (invoice metadata + line items) as defined in `data_model.md`
- Raw result display: show what was extracted so extraction quality can be evaluated against real invoices
- No `ExtractionResult` record written yet; no `DocumentProcessingEvent`; no retry logic; synchronous or minimally async

**Explicitly deferred:** Celery task chain, event log, retry/failure handling, confirm step, Invoice/LineItem promotion.

**Milestone:** upload a real invoice and see structured line items extracted from it. Use this phase to tune the extraction prompt against real data before building the pipeline around it. ✅ Done — implemented in `web/src/lib/extraction.ts` using Claude (vision), tested against a real receipt. Superseded in Phase 3 — this file was deleted once extraction moved into `workers/`.

**Known issue found and fixed:** on the real receipt tested, one line item's description absorbed unrelated text from elsewhere on the document (`BRCKT, CARPORT 13GA SDL HDG 6X6"` picked up a `THURSDAY DELIVERY` note that isn't part of the item description). Fixed by constraining each line item's description to its own table cell in the prompt — see `workers/estimator_workers/extraction.py`. Not re-verified against a real receipt with the tightened prompt yet (Phase 3 testing used the same receipt but didn't specifically re-check this line item).

---

### Phase 3 — Formalize the Pipeline

Move extraction into the architecture-specified Celery task chain with event logging and retry semantics. See `architecture.md` → Extraction Pipeline for the full design.

**In scope:**
- Celery task chain: `fetch` → `extract` → `parse` stages, each a discrete task
- `DocumentProcessingEvent` table: one row per stage attempt including every Celery retry (see `data_model.md`)
- On upload: Next.js publishes Celery task to RabbitMQ with `document_id`, `company_id`, and `storage_path`
- Retry/backoff: Celery auto-retry on transient failures per stage; terminal failure sets `Document.status = failed` and inserts final failed event row
- Frontend polling: query latest `DocumentProcessingEvent` rows to render live pipeline progress ("processing...") vs. completion
- No manual retry UI: terminal failure surfaces as failed status; re-upload is the user's only recovery path (creates a new `Document` record per `architecture.md`)
- `ExtractionResult` written by the final pipeline stage on success

**Explicitly deferred:** confirm step, Invoice/LineItem promotion (those come in Phase 4).

**Milestone:** upload a document, watch the pipeline stages run (or fail), see `DocumentProcessingEvent` rows in the database reflecting real stage progress. ✅ Done — verified end-to-end against the live Supabase project and a real RabbitMQ (CloudAMQP) instance: a real receipt ran fetch → extract → parse successfully (all 3 events `succeeded`, `ExtractionResult` written, `Document.status` correctly stayed `pending`), and a PDF (unsupported type) correctly retried 3 times with linear backoff (10s/20s/30s) before terminal failure set `Document.status = failed` and the chain correctly stopped before `parse`.

**Implementation notes:**
- Next.js publishes to RabbitMQ via `celery-node`, but bypasses its high-level `Client.sendTask()`/`Task.delay()` API — that path is fire-and-forget with no way to await success or catch a connection failure. `web/src/lib/celery.ts` calls the broker directly instead so a publish failure surfaces as a thrown error to the upload action.
- `DocumentProcessingEvent` is one row per attempt that transitions `started` → `succeeded`/`failed` (not two separate rows), since the schema's `started_at`/`finished_at` columns only make sense on a single row per attempt.

**Known minor UI gap:** the frontend polling in `documents-table.tsx` only fetches `DocumentProcessingEvent` rows for currently-`pending` documents. If you land on the project page after a document has already reached a terminal state (`failed`), the status badge is correct but the specific stage/error detail text doesn't show — polling never ran for it on this page load. Not a pipeline bug; worth a follow-up if debugging failed documents becomes a real workflow.

---

### Phase 4 — Confirm Step and Promotion

Users review extracted data and confirm it. Confirmed data is promoted into the canonical Invoice and LineItem records that form the searchable historical knowledge base.

**In scope:**
- Confirm UI: frontend reads `ExtractionResult.payload` when the final pipeline stage has a `succeeded` event row; presents extracted invoice metadata and line items for user review
- Confirm action: Next.js validates `ExtractionResult` payload → creates `Invoice` and `LineItem` records → sets `Document.status = confirmed` (see `data_model.md` for schemas)
- Supplier resolution: on confirm, match extracted supplier name against global `Supplier` table; create new `Supplier` + `CompanySupplier` if no match, or link to existing; auto-match treatment mirrors material matching (same problem — variant phrasings — but for supplier names)
- `ExtractionResult` retained permanently after promotion; never deleted
- Confirm step is intentionally minimal (no field-level editing in MVP; a richer correction UI is post-MVP per `product-mvp.md`)

**Explicitly deferred:** material catalog matching (Phase 5), search (Phase 6), estimates (Phase 7).

**Milestone:** upload a document, let it process, confirm the extracted data, and verify that `Invoice` and `LineItem` records appear in the database with correct values.

---

### Phase 5 — Material Matching

Auto-match confirmed line items to the company's material catalog. Surface proposed matches for user review; allow flagging wrong matches.

**Note:** the implementation approach for matching is an open architecture question — see `architecture.md` → Open Questions → Material-matching implementation. This question must be resolved before Phase 5 begins. Options range from Postgres trigram similarity to embeddings to an LLM call; the choice affects both the workers/ code and whether any new infrastructure (vector store) is needed.

**In scope (once approach is decided):**
- `MaterialCatalog` management (company-scoped canonical materials)
- Auto-matching: runs after user confirmation, proposes `MaterialMatch` records linking `LineItem` to `MaterialCatalog` entries
- `MaterialMatch.status`: `proposed` (auto-matched, unreviewed) or `flagged` (user rejected the match)
- UI: surface proposed matches per confirmed invoice; allow user to flag incorrect matches
- Flagging never changes `LineItem.description`, `Document.status`, or the original document — it only changes `MaterialMatch.status`

**Explicitly deferred:** using material matches as a search grouping layer (that's search, Phase 6).

**Milestone:** confirm an invoice and see line items auto-matched to catalog entries, with the ability to flag a wrong match.

---

### Phase 6 — Search

Make confirmed line items searchable across the company's full history.

**Note:** the search and indexing approach is an open architecture question — see `architecture.md` → Open Questions → Search and indexing. This must be resolved before Phase 6 begins. Postgres full-text search (no new infrastructure) vs. a dedicated index like Meilisearch are the primary options.

**In scope (once approach is decided):**
- Search UI: query by material, supplier, project, SKU, or description
- Results surface: `LineItem` data (description, quantity, unit price, total) with project, invoice date, and supplier context
- Material catalog grouping: searching "PT 2x8" should surface all confirmed line items matched to the same `MaterialCatalog` entry regardless of how the supplier described them on the invoice

**Milestone:** search "PT 2x8" and get back every historical purchase of that material across all projects, with correct prices and supplier attribution.

---

### Phase 7 — Estimates

Users create estimates referencing historical line items and pricing.

**Note:** the estimate-building data flow is an open architecture question — see `architecture.md` → Open Questions → Estimate-building data flow. The `Estimate` schema in `data_model.md` is currently unspecced. This must be resolved before Phase 7 begins. Key decisions: snapshot vs. live link to historical `LineItem` records, and where markup/inflation adjustments live.

**In scope (once data flow is decided):**
- Estimate creation: new estimate scoped to a project
- Historical reference: search and pull in historical line items as estimate lines
- Markup/inflation adjustments: configurable per product spec (`product-mvp.md` → Build Estimates)
- Estimate remains fully editable after historical data is pulled in

**Milestone:** create an estimate for a new project, pull in historical PT 2x8 pricing from a past job, apply a markup, and produce an editable estimate line.

---

## Open Questions Requiring Resolution Before Their Phase

| Question | Blocks | Reference |
|----------|--------|-----------|
| Search and indexing approach | Phase 6 | `architecture.md` → Open Questions |
| Material-matching implementation | Phase 5 | `architecture.md` → Open Questions |
| Estimate-building data flow + Estimate schema | Phase 7 | `architecture.md` → Open Questions, `data_model.md` → Estimate |
