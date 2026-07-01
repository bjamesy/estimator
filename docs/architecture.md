# Architecture

**Status:** Draft — decisions recorded through 2026-06-30 design session. Three subsystems flagged as open questions at the bottom.

Related: [Product Spec](./product-mvp.md), [Data Model](./data_model.md)

---

## System Overview

Estimator is a document-ingestion and search product. Its core flow is:

```
Upload document
    → store original (permanent)
    → extract structured data via vision LLM (async pipeline)
    → user reviews and confirms extracted data
    → confirmed line items enter the searchable historical knowledge base
    → material catalog matching surfaces groupings for user review
    → confirmed history is used to build estimates
```

---

## Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Web app | Next.js (TypeScript) | Frontend + server-side API routes |
| Async workers | Python + Celery | Extraction pipeline; runs as a separate service |
| Message broker | RabbitMQ | Chosen over Redis for durable queue semantics and reliable ack/nack in multi-stage pipelines; run managed (e.g. CloudAMQP) |
| Database | Postgres via Supabase | Shared Postgres, table-level write ownership split: worker owns `DocumentProcessingEvent` and `ExtractionResult`; Next.js owns `Invoice`, `LineItem`, and `Document.status` transitions (worker writes only the terminal `failed` status) |
| File storage | Supabase Storage | S3-compatible; used for original documents; avoids a second storage vendor |
| Extraction | Vision LLM (e.g. GPT-4o or Claude) | Single API call per document; returns structured JSON |

The web app and Python worker service are separate deployments sharing one Postgres database. The worker's deployment shape (long-lived container vs. serverless functions) is an implementation-time decision; the architecture does not lock it down.

---

## Company Scoping

All data is company-scoped; there is no cross-company sharing in MVP (see `product-mvp.md`). Enforcement:

- **Postgres:** Supabase Row Level Security (RLS) policies on every table, scoped by `company_id`. This is the primary enforcement boundary — both Next.js and the Python worker query through it, so a bug in either codebase's filtering logic can't leak cross-company data.
- **Celery task payload:** every task carries `company_id` alongside `document_id`, so a worker scoping a lookup (e.g. a MaterialCatalog match) has it available without a join back through Document.
- **Next.js API routes:** scope all queries by the authenticated user's `company_id` in addition to relying on RLS — defense in depth, not a substitute for it.

**Exception:** `Supplier` is a deliberate, global, non-company-scoped table — see Data Model below. It carries no `company_id` and is intentionally outside RLS. Anything company-specific about a supplier relationship lives on `CompanySupplier`, which is company-scoped like everything else.

---

## Document Storage

Original documents are written to Supabase Storage on upload and never modified or deleted. The storage path is recorded on the Document record. Structured data is always derived from originals; originals are the source of truth.

---

## Extraction Pipeline

The extraction pipeline runs as a chain of Celery tasks. Each stage is a discrete task: for example, `fetch` (retrieve file from Supabase Storage) → `extract` (call vision LLM) → `parse` (structure LLM response into ExtractionResult).

### Progress tracking: DocumentProcessingEvent

The pipeline never writes to `Document.status`. Fine-grained progress lives entirely in an append-only `DocumentProcessingEvent` table. Each stage attempt — including every Celery retry — inserts its own row.

```
DocumentProcessingEvent
  id
  document_id       FK → Document
  stage             e.g. "fetch" | "extract" | "parse"
  status            "started" | "succeeded" | "failed"
  error_message     null on success; populated on failure
  attempt_number    increments per retry within a stage
  started_at
  finished_at
```

The frontend determines pipeline state by querying the latest event row(s) for a document. If the final stage (e.g. `parse`) has a `succeeded` row, extraction is complete and the confirmation screen is shown. Otherwise a progress indicator is shown based on the latest event.

### Retry and failure

Celery handles retries automatically with backoff on transient failures. If a stage exceeds its configured retry limit, it inserts a `failed` event row and the job is considered terminally failed. There is no manual retry from the UI. The user's only path after terminal failure is re-uploading the document.

Re-uploading creates a new `Document` record (new `document_id`, new pipeline run) rather than reusing the failed one. The failed `Document` and its `DocumentProcessingEvent` history are left in place as a record of what happened. This also means a stale in-flight task from a failed run can never write results against a document the user has since replaced — it can only ever write against its own `document_id`, which stays terminally `failed`.

---

## Document Status

`Document.status` is coarse-grained and reflects only terminal outcomes. The pipeline never writes intermediate status to it — the one exception is terminal failure, which the worker sets directly.

| Status | Set by | Meaning |
|--------|--------|---------|
| `pending` | Next.js at document creation | Document uploaded; pipeline running or extraction complete but not yet confirmed |
| `failed` | Celery worker on terminal failure | Pipeline failed unrecoverably |
| `confirmed` | Next.js on user confirm action | User has reviewed and confirmed extracted data |

`pending` covers the entire window from upload through extraction completion. The distinction between "pipeline still running" and "ready for user review" is determined by querying DocumentProcessingEvent, not by Document.status.

---

## ExtractionResult and the Confirm Step

When the final pipeline stage succeeds, it writes to an `ExtractionResult` table:

```
ExtractionResult
  id
  document_id       FK → Document
  payload           structured JSON (invoice metadata + line items as extracted)
  created_at
```

The Python worker owns the shape of this output. `ExtractionResult` is the surface the user reviews during the confirm step — the Next.js API reads from it to render the confirmation screen.

`ExtractionResult` rows are retained permanently, even after promotion to `Invoice`/`LineItem`. It's the durable record of raw vision LLM output per document, independent of the confirmed record's lifecycle.

When the user confirms, Next.js:
1. Validates the ExtractionResult payload
2. Promotes it into canonical `Invoice` and `LineItem` records
3. Sets `Document.status = confirmed`

Next.js owns the promotion and validation logic. Schema changes to `Invoice` or `LineItem` only require updates to the Next.js promotion code, not to the Python worker.

The confirm step is intentionally minimal in MVP. A richer correction UI (editing individual fields before confirming) is post-MVP.

---

## Upload-to-Pipeline Handoff

1. User uploads a file via the Next.js API route
2. Next.js writes the original to Supabase Storage
3. Next.js creates a `Document` record with `status = pending` and records the storage path
4. Next.js publishes a Celery task to RabbitMQ containing the `document_id`, `company_id`, and storage path
5. Python worker picks up the task, begins the pipeline stage chain
6. On terminal success: worker writes `ExtractionResult`, inserts final `DocumentProcessingEvent` with `status = succeeded`
7. On terminal failure: worker sets `Document.status = failed`, inserts final `DocumentProcessingEvent` with `status = failed`
8. Frontend polls by querying `DocumentProcessingEvent` to render live progress; reads `ExtractionResult` on completion

---

## Open Questions

These three subsystems were not resolved in the design session and need to be specced before implementation.

### 1. Search and indexing — ✅ Resolved (Phase 6)

How confirmed line items are made searchable had not been decided. Options considered:
- Postgres full-text search (no new infrastructure; may be sufficient for MVP query patterns)
- A dedicated search index such as Meilisearch or Elasticsearch (more capable; more to operate)

**Decision: plain Postgres `ilike` matching via a single SQL function** (`search_line_items`, `database/migrations/0007_search_line_items.sql`), not `tsvector`/full-text search and not a dedicated search service. The function joins `line_items` → `invoices` → `projects`/`suppliers`, left-joins `material_matches` → `material_catalog`, and matches the query against material name, description, SKU, supplier name, and project name in one query, company-wide (not project-scoped) per the product spec's own search example.

**Reasoning:**
- At MVP scale (a single company's full purchase history — hundreds to low thousands of line items, not millions), plain `ilike` needs no index tuning to stay fast; `tsvector` columns or a dedicated search service would be solving a scale problem that doesn't exist yet.
- The function is `security invoker` (the default), not `security definer` — it adds no scoping of its own and relies entirely on the RLS policies already enforced on every table it touches, so there was no new access-control surface to design.
- Matching against `MaterialCatalog.name` (via the `material_matches` left join) rather than only raw `LineItem.description` is what makes Phase 5's investment pay off: searching "PT 2x8" surfaces every purchase matched to that canonical material regardless of how each supplier phrased it on the original invoice.
- The left join (not inner join) to `material_matches`/`material_catalog` matters: a line item with no match yet (or a document confirmed before Phase 5 existed) still surfaces in search via its raw description/SKU, just without a material name — verified in testing.

**Verified in testing:** searching "PT 2x8" against two confirmed invoices with overlapping PT 2x8x12/PT 2x8x16 purchases returned all 4 line items with correct canonical material names, project links, supplier, and pricing — reproducing the product spec's own canonical search example exactly. Searching a SKU directly (`PT2812`) correctly returned 3 results across all 3 confirmed invoices, including one from before Phase 5 existed (shown with no material name, confirming the left join degrades gracefully on unmatched data rather than excluding it).

### 2. Material-matching implementation — ✅ Resolved (Phase 5)

The approach that powers automatic catalog matching had not been chosen. Options considered:
- Fuzzy string matching (e.g. trigram similarity in Postgres, or a library like RapidFuzz in Python)
- Embeddings (semantic similarity; requires an embedding model and vector storage)
- LLM call (flexible; higher cost per match; least deterministic)
- Hybrid (fuzzy first, LLM for low-confidence cases)

**Decision: a single batched LLM call (Claude) per confirmed invoice**, run in `workers/` (`estimator_workers/matching.py` + the `match_materials` Celery task), triggered by the confirm action after promotion — not blocking it. One call handles every line item on the invoice against the company's full `MaterialCatalog` at once, rather than one call per line item.

**Reasoning:**
- Claude was already proven during Phase 2/3 extraction testing to correctly interpret supplier abbreviations (e.g. reading "CNCRTE" as concrete) — the exact recall problem this decision needed to solve.
- A per-company material catalog is small (dozens to low hundreds of entries for an MVP-stage company), so batching the whole catalog + all line items into one prompt stays fast and cheap — no need for approximate/indexed search over a large corpus, which is what fuzzy matching and embeddings are for.
- Avoids introducing a new dependency. Embeddings would have required a vector store (e.g. pgvector) and an embeddings provider (Anthropic has no embeddings endpoint of its own); fuzzy matching would have needed a new library or Postgres extension. An LLM call reuses the Anthropic integration already wired into `workers/`.
- Matching runs after confirmation, not during extraction, per the product principle that "confirm what was actually purchased" and "the system does its catalog grouping" are separate concerns — see the `MaterialMatch` section below.

**Verified in testing:** confirming a second invoice with overlapping materials correctly matched all line items to the *existing* `MaterialCatalog` rows created by the first invoice (zero duplicate catalog entries), while a first-ever invoice for a company correctly created new entries. The LLM also made a reasonable catalog-granularity judgment call unprompted — treating different lumber lengths (e.g. "PT 2x8x12" vs "PT 2x8x16") as distinct materials rather than collapsing them, which aligns with "historical accuracy over categorization" in `product-mvp.md` since they have genuinely different prices.

**Known limitation carried forward:** no confidence threshold or fallback — every line item gets a `proposed` match, right or wrong, and the only human check is post-hoc flagging. If this proves too noisy in practice, a hybrid approach (e.g. fuzzy pre-filter, LLM only for ambiguous cases) is the natural next step, not a redesign.

### 3. Estimate-building data flow

How estimates are structured, stored, and linked to historical line items has not been specced. Key questions:
- What does an Estimate record contain, and what is its relationship to LineItems?
- How does referencing a historical line item work — is it a snapshot of the price at reference time, or a live link?
- Where do markup/inflation adjustments live — on the estimate line, on the estimate itself, or as a separate config?
