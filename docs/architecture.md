# Architecture

**Status:** Implemented. All phases (0–7) of `mvp/implementation_plan.md` are complete and verified end-to-end against a live Supabase project as of 2026-07-01. The three subsystems originally flagged as open questions (search, material matching, estimates) are resolved — see the bottom of this document for each decision and its reasoning.

Related: [Product Spec](./mvp/product-mvp.md), [Data Model](./data_model.md), [Implementation Plan](./mvp/implementation_plan.md) — `mvp/` is frozen history from the MVP build, no longer maintained

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
    → company-wide search surfaces historical purchases (Phase 6)
    → confirmed history is used to build estimates (Phase 7, snapshot-based)
```

---

## Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Web app | Next.js (TypeScript) | Frontend + server-side API routes |
| Async workers | Python + Celery | Extraction pipeline; runs as a separate service |
| Message broker | RabbitMQ | Chosen over Redis for durable queue semantics and reliable ack/nack in multi-stage pipelines; run managed (e.g. CloudAMQP) |
| Database | Postgres via Supabase | Shared Postgres, table-level write ownership split: worker owns `DocumentProcessingEvent`, `ExtractionResult`, `MaterialMatch`/`MaterialCatalog` (via the `match_materials` task), and `EstimateVersion.pdf_storage_path` (via the `render_change_order_pdf` task); Next.js owns `Invoice`, `LineItem`, `Estimate`/`EstimateLine`, `EstimateVersion`/`EstimateVersionLine`/`EstimateSignature`/`ClientSigningToken`, and `Document.status` transitions (worker writes the terminal `failed` and `rejected` statuses) |
| File storage | Supabase Storage | S3-compatible; used for original documents; avoids a second storage vendor |
| Extraction & matching | Claude (`claude-sonnet-5`), via Anthropic's API | One vision call per document for extraction (`workers/estimator_workers/extraction.py`); one batched text call per confirmed invoice for material matching (`workers/estimator_workers/matching.py`) |

The web app and Python worker service are separate deployments sharing one Postgres database. The worker's deployment shape (long-lived container vs. serverless functions) is an implementation-time decision; the architecture does not lock it down.

---

## Company Scoping

All data is company-scoped; there is no cross-company sharing in MVP (see `mvp/product-mvp.md`). Enforcement:

- **Postgres:** Supabase Row Level Security (RLS) policies on every table, scoped by `company_id`. This is the primary enforcement boundary — both Next.js and the Python worker query through it, so a bug in either codebase's filtering logic can't leak cross-company data.
- **Celery task payload:** every task carries `company_id` alongside `document_id`, so a worker scoping a lookup (e.g. a MaterialCatalog match) has it available without a join back through Document.
- **Next.js API routes:** scope all queries by the authenticated user's `company_id` in addition to relying on RLS — defense in depth, not a substitute for it.

**Exception:** `Supplier` is a deliberate, global, non-company-scoped table — see Data Model below. It carries no `company_id` and is intentionally outside RLS. Anything company-specific about a supplier relationship lives on `CompanySupplier`, which is company-scoped like everything else.

**Exception (v2, change orders):** the public client-signing page (`/sign/[token]`, `web/src/app/sign/`) is the one surface with no session at all — clients are not users. Authorization is the 256-bit single-use signing token in the URL itself (stored only as a hash; see `ClientSigningToken` in `data_model.md`). Because no RLS identity exists for a signing client, that page and its action (`web/src/app/actions/client-signing.ts`) run through the server-side admin client, keyed strictly off the token row's own ids — there are deliberately **no anon RLS policies** anywhere. The middleware allowlists `/sign` without bouncing signed-in users (`TOKEN_AUTHORIZED_PATHS`, `web/src/lib/supabase/middleware.ts`). Relatedly, `estimate_signatures` narrows the usual blanket `for all` company policy to select+insert only — a signed change order is a legal artifact no session may alter (see `0017_signatures.sql`).

---

## Document Storage

Original documents are written to Supabase Storage on upload and never modified or deleted. The storage path is recorded on the Document record. Structured data is always derived from originals; originals are the source of truth.

---

## Extraction Pipeline

All pipeline task definitions live in `workers/estimator_workers/tasks.py`.

A single entry-point task, `estimator_workers.tasks.process_document(document_id, company_id, storage_path)`, is what Next.js publishes on upload (see Upload-to-Pipeline Handoff below). It doesn't do any work itself — it immediately builds and enqueues a Celery `chain` of three stage tasks, each independently retryable:

```
process_document
  → estimator_workers.tasks.fetch      (download the file from Supabase Storage)
  → estimator_workers.tasks.extract    (call the vision LLM; see extraction.py)
  → estimator_workers.tasks.parse      (validate + write ExtractionResult)
```

Celery chains implicitly pass each task's return value as the first positional argument to the next task — `fetch` returns the file as base64, which `extract` receives as its `file_b64` parameter and passes to the vision LLM; `extract` returns the LLM's raw text response, which `parse` receives as `raw_text` and validates/structures.

Each of the three stage tasks shares a common wrapper, `_run_stage(task, document_id, stage, fn)`, which:
- Logs a `DocumentProcessingEvent` row before running the stage's work
- On success, updates that row to `succeeded`
- On failure, updates it to `failed` and either retries (linear backoff: `10s × attempt_number`, up to `MAX_RETRIES = 3`) or, once retries are exhausted, calls `mark_document_failed` to set `Document.status = failed`

`process_document` itself has no retry configuration (unlike the three stages it enqueues) — if enqueueing the chain fails outright (e.g. the broker is briefly unreachable at that exact moment), it logs a one-shot `"enqueue"` stage failure and terminal-fails the document directly, rather than leaving it stuck at `pending` with no trace. See `database/migrations/0010_data_safety_fixes.sql`'s companion code fix for why this matters.

A second, independent task — `estimator_workers.tasks.match_materials(invoice_id, company_id)` — is published by the confirm action (not by upload) once a document is confirmed. It isn't part of the extraction chain and has no `DocumentProcessingEvent` equivalent; see `MaterialMatch` in `data_model.md` and the Material-matching implementation decision below.

### Supported file types

The pipeline accepts JPEG, PNG, HEIC/HEIF, and PDF (`SUPPORTED_MIME_TYPES` in `workers/estimator_workers/extraction.py`; mirrored at upload by `ALLOWED_TYPES` in `web/src/app/actions/documents.ts`, which also falls back to extension matching because some browsers report an empty MIME type for HEIC). Three of these are not what they appear at the API boundary:

- **HEIC/HEIF** (iPhone's default camera format) isn't accepted by Claude's vision API (JPEG/PNG/GIF/WEBP only), so `call_vision_llm` converts it to JPEG **in memory, transiently, for the API call only** — the converted bytes are never written to Storage and never replace the stored original, per "documents are source of truth... originals are always retained." The file in Storage stays byte-identical to what the user uploaded (verified live: downloaded the stored object after a full pipeline run and confirmed it identical to the source HEIC).
- **PDF** goes through Claude's native `document` content block rather than an `image` block — Anthropic converts pages to images and extracts per-page text internally, all within one request, so multi-page PDFs need no special handling in this codebase. API limits (32MB request / up to 600 pages) are far beyond any realistic invoice and are not separately enforced here.
- A corrupt/undecodable file simply raises inside the `extract` stage and flows through `_run_stage`'s normal retry/terminal-failure machinery — no special error handling exists for conversion failures.

Mime type is guessed from the storage filename's extension (`_guess_mime_type` in `tasks.py`), not from content sniffing — acceptable because the upload action controls the storage filename.

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

Celery handles retries automatically with backoff on transient failures. If a stage exceeds its configured retry limit, it inserts a `failed` event row and the job is considered terminally failed. There is no manual retry from the UI for terminal *failure*. The user's only path after terminal failure is re-uploading the document.

Re-uploading creates a new `Document` record (new `document_id`, new pipeline run) rather than reusing the failed one. The failed `Document` and its `DocumentProcessingEvent` history are left in place as a record of what happened. This also means a stale in-flight task from a failed run can never write results against a document the user has since replaced — it can only ever write against its own `document_id`, which stays terminally `failed`.

**Stalled is a distinct state from failed, and it does get a retry.** A document can be stranded in `pending` without ever failing: the task message is lost before completing (broker wiped mid-chain, worker down when the message arrived, publish succeeded but nothing consumed it). Nothing in the pipeline will ever touch that document again, no `failed` event exists, and waiting doesn't help. The documents table detects this — a `pending` document with no `ExtractionResult` and no pipeline event activity for 5 minutes (comfortably past the worst legitimate retry-backoff quiet stretch) shows a "processing stalled" indicator and a **Retry processing** button (`retryDocumentProcessing` in `web/src/app/actions/documents.ts`, which re-checks the staleness gate server-side before re-publishing). Re-publishing `process_document` is safe by construction: `fetch` re-downloads, `extract` re-calls the LLM, and `parse` writes a fresh `ExtractionResult` row (multiple can exist; the confirm step reads the latest). This doesn't conflict with the no-retry-on-failure decision above — a failed document records *what went wrong* and re-running would hit the same wall; a stalled document simply never got its work done.

---

## Document Status

`Document.status` is coarse-grained and reflects only terminal outcomes. The pipeline never writes intermediate progress to it — the exceptions are terminal failure and rejection, which the worker sets directly.

| Status | Set by | Meaning |
|--------|--------|---------|
| `pending` | Next.js at document creation | Document uploaded; pipeline running or extraction complete but not yet confirmed |
| `failed` | Celery worker on terminal failure | Pipeline failed unrecoverably |
| `rejected` | Celery worker on classification | Successfully processed, but not a purchase document — nothing to confirm |
| `confirmed` | Next.js on user confirm action | User has reviewed and confirmed extracted data |

`pending` covers the entire window from upload through extraction completion. The distinction between "pipeline still running" and "ready for user review" is determined by querying DocumentProcessingEvent, not by Document.status.

**Classification and `rejected` (post-MVP, 2026-07-03).** The single extraction call now also classifies the document (`document_type` ∈ `invoice`/`receipt`/`other`, plus a one-line `rejection_reason`) — folded into the same vision request rather than a separate pre-flight, since the image is already loaded. A document that isn't a record of an actual completed purchase (a quote, PO, or statement — none of which are money actually spent — or a non-purchase file like a resume or blank page) is set to `rejected` in the `parse` stage with its reason, writes **no** `ExtractionResult`, and offers no Confirm; the review page and documents table render it calmly rather than as a red error. This is deliberately **not** `failed`: `failed` means a pipeline error worth retrying, while `rejected` is a *successful* determination that there's nothing to extract. `rejected` is the one place a stage's own work writes `Document.status` on success (terminal failure remains the other worker-written status). On rejection the worker also **best-effort deletes the stored object** (it isn't part of the purchasing record the "originals are retained" principle protects, and may be a sensitive misfire like a photo of an ID), keeping the `Document` row as a tombstone that still shows the filename and reason. The idempotency index excludes `rejected` alongside `failed`, so a user who disagrees can re-upload (`0014_document_rejected_status.sql`). Separately, deterministic `parse` failures (malformed JSON, or an accepted payload that fails validation) now raise `NonRetryableExtractionError` and fail terminally on the first attempt instead of burning all three retries re-parsing identical output.

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

`invoices.document_id` has a unique constraint specifically to make a raced double-confirm (two concurrent requests both passing the `status = "pending"` check before either commits) fail cleanly on the second insert instead of silently creating two invoices for the same document — see `database/migrations/0010_data_safety_fixes.sql`.

---

## Upload-to-Pipeline Handoff

1. User uploads a file via the `uploadDocument` Server Action (`web/src/app/actions/documents.ts`). The upload form (`upload-form.tsx`) auto-submits the moment a file is selected — no separate Upload button — and on touch devices additionally offers a "Take photo" button that opens the camera directly (`capture="environment"` on the shared hidden file input; the button is shown via CSS `pointer: coarse` detection, since screen width is a poor proxy for "has a camera")
2. Next.js verifies the target project belongs to the caller's company (RLS alone doesn't check this — see Company Scoping) and computes a SHA-256 of the file, hard-blocking a byte-identical re-upload within the same project before anything is written (per-project idempotency — see `content_hash` in `data_model.md` → Document). Then it writes the original to Supabase Storage
3. Next.js creates a `Document` record with `status = pending` and records the storage path
4. Next.js publishes the `estimator_workers.tasks.process_document` Celery task to RabbitMQ containing the `document_id`, `company_id`, and storage path
5. Python worker picks up the task, begins the `fetch → extract → parse` stage chain (see Extraction Pipeline above)
6. On terminal success: worker writes `ExtractionResult`, inserts final `DocumentProcessingEvent` with `status = succeeded`
7. On terminal failure: worker sets `Document.status = failed`, inserts final `DocumentProcessingEvent` with `status = failed`
8. Frontend polls by querying `DocumentProcessingEvent` to render live progress; reads `ExtractionResult` on completion

### How Next.js actually publishes to RabbitMQ

Step 4 is worth documenting precisely because it doesn't use the obvious API. All task publishing goes through `web/src/lib/celery.ts`, which exports `publishProcessDocumentTask` (used by upload) and `publishMatchMaterialsTask` (used by confirm, for the `match_materials` task — see Extraction Pipeline above).

Both are thin wrappers around a shared `publishTask(taskName, args)` helper that **deliberately bypasses** the `celery-node` library's normal high-level API (`Client.sendTask()` / `Task.delay()`). That API is fire-and-forget — the promise chain inside its `sendTaskMessage()` is never returned to the caller, so a broker connection failure becomes a silent unhandled rejection with no way for the calling code to know publishing failed.

Instead, `publishTask` drives the lower-level pieces of the same library directly:

```ts
const message = celery.createTaskMessage(taskId, taskName, args, {});
await celery.broker.isReady();
await celery.broker.publish(message.body, "", QUEUE, message.headers, message.properties);
```

This constructs the Celery protocol v2 task message by hand and publishes it to the `celery` queue on the default exchange, awaiting both steps — so a broker hiccup at publish time throws back up into the calling Server Action (`uploadDocument` or `confirmDocument`) instead of disappearing. For `uploadDocument` specifically, that means the user sees an inline error instead of a document silently stuck at `pending` forever with no pipeline ever having run.

`publishTask` opens a fresh AMQP connection for each call and closes it (`celery.broker.disconnect()`) once the publish resolves, rather than caching one long-lived connection across calls. This is deliberate, not an oversight — see "Heartbeats are disabled" below.

### Heartbeats are disabled

Neither side of this app pins an AMQP heartbeat, and the effective behavior is asymmetric between them:

- **`workers/` (Celery/py-amqp)** sets `app.conf.broker_heartbeat = 0` (`estimator_workers/celery_app.py`). py-amqp's negotiation explicitly overrides the broker's proposed heartbeat to `0` when the client disables it, and sends that `0` back to the broker in `ConnectionTuneOk` — so the broker also agrees not to expect heartbeats on this connection. Verified live against CloudAMQP: the negotiated `connection.heartbeat` is `0` even though the broker still proposes a non-zero value.
- **`web/` (`celery-node`/`amqplib`)** has no equivalent override — `amqplib`'s negotiation always defers to whatever the broker proposes once the broker's value is non-zero, regardless of what the client requests (confirmed empirically: neither an `opts.heartbeat` nor a `?heartbeat=0` query param changes the negotiated value against this project's CloudAMQP instance). A long-lived cached connection sitting idle between uploads/confirms would therefore keep sending heartbeat frames at the broker's interval no matter what config is set. Since publishing here is a one-shot, infrequent, user-triggered action (not a persistent consumer, unlike `workers/`), the fix is architectural rather than a config flag: `publishTask` connects, publishes, and disconnects immediately (above) — a connection that short-lived never survives long enough for the negotiated heartbeat interval to elapse, so no heartbeat frame is ever sent.

This trade-off (an extra connect handshake per publish, in exchange for zero idle-connection heartbeat traffic) is worth revisiting once there's real production traffic where either the added latency or dead-connection detection start to matter more than avoiding CloudAMQP's per-message metering pre-launch.

The same quota-consciousness is why `docker-compose.yml` runs its own local RabbitMQ container instead of pointing at this CloudAMQP instance for local dev — see the comment on the `rabbitmq` service there.

---

## Open Questions (Resolved)

These three subsystems were not resolved in the original design session. All three are now resolved and implemented — kept here for the decision history and reasoning, not as outstanding work.

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
- Matching runs after confirmation, not during extraction, per the product principle that "confirm what was actually purchased" and "the system does its catalog grouping" are separate concerns — see `data_model.md` → MaterialMatch.

**Verified in testing:** confirming a second invoice with overlapping materials correctly matched all line items to the *existing* `MaterialCatalog` rows created by the first invoice (zero duplicate catalog entries), while a first-ever invoice for a company correctly created new entries. The LLM also made a reasonable catalog-granularity judgment call unprompted — treating different lumber lengths (e.g. "PT 2x8x12" vs "PT 2x8x16") as distinct materials rather than collapsing them, which aligns with "historical accuracy over categorization" in `mvp/product-mvp.md` since they have genuinely different prices.

**Known limitation carried forward:** no confidence threshold or fallback — every line item gets a `proposed` match, right or wrong, and the only human check is post-hoc flagging. If this proves too noisy in practice, a hybrid approach (e.g. fuzzy pre-filter, LLM only for ambiguous cases) is the natural next step, not a redesign.

### 3. Estimate-building data flow — ✅ Resolved (Phase 7)

How estimates are structured, stored, and linked to historical line items had not been specced.

**Decision: snapshot, not a live link.** Pulling a historical `LineItem` into an estimate copies its `description`/`quantity`/`unit_price` into a new `EstimateLine` row. `EstimateLine.source_line_item_id` keeps a nullable FK back to the original purely for provenance ("this line came from that historical purchase") — it is never re-read after creation. `EstimateLine` also supports no source at all, for a manually-added line.

**Reasoning:**
- Consistent with the snapshot pattern already used everywhere else in the system: `ExtractionResult` → `Invoice`/`LineItem` promotion is a one-time copy, not a live reference either. Estimates get the same treatment.
- "The estimate remains fully editable" (`mvp/product-mvp.md` → Build Estimates) only makes sense if an estimate line is independent of its source the moment it's added — a live link would mean editing the estimate line's price doesn't actually mean anything, or worse, editing the *source* `LineItem` retroactively changes past estimates.
- A live link also has a real failure mode a snapshot avoids: if the source line item's material match is later flagged wrong (Phase 5) or the underlying document is somehow found to be bad, that shouldn't silently mutate an estimate a contractor already sent to a client.

**Markup/inflation adjustment lives per-line**: `EstimateLine.markup_percent` (default 0), not an estimate-level global field and not a separate config table. Simplest field that still supports a blanket rate across an estimate if the user sets the same value on every line; an estimate-level default can be added later without a schema change if that turns out to be a common enough workflow to warrant a UI shortcut.

**Update (post-MVP, 2026-07-02) — project became optional.** `Estimate.project_id` was originally a required FK (`not null`, `on delete cascade`), nesting every estimate under a project's routes (`/projects/[id]/estimates/[estimateId]`). Revisited: `Project`s exist to hold actual purchasing history (receipts/invoices — ground truth per "documents are source of truth"), while `Estimate`s are projections that draw on the company-wide historical knowledge base (`search_line_items` has always been company-scoped, never project-scoped — see Open Question #1 above). The two aren't meaningfully coupled. `project_id` is now nullable and optional (`database/migrations/0011_estimates_project_optional.sql`) — an estimate may reference a project for organizational convenience, but doesn't have to, and there is deliberately no promotion/conversion flow from `Estimate` to `Project` (a projection should never silently become recorded purchasing history). The FK changed from `on delete cascade` to `on delete set null`: an `Estimate` is not historical data, so unlike the `RESTRICT` chain protecting `Document`/`Invoice`/`LineItem` (`0010_data_safety_fixes.sql`), a deleted project neither blocks nor destroys a linked estimate — the estimate simply survives with its reference cleared. Routes moved from `/projects/[id]/estimates/[estimateId]` to a top-level `/estimates` and `/estimates/[estimateId]`.

**Update (post-MVP, 2026-07-02) — bulk-create an estimate from a project's history.** `createEstimateFromProject` (`web/src/app/actions/estimates.ts`) seeds a new estimate from everything actually purchased on a given project, instead of the user manually searching and adding one line at a time (`addHistoricalLineToEstimate`). For each canonical material used on the project (grouped by a `"proposed"` `MaterialMatch` — a `"flagged"` match's grouping isn't trusted, so those are treated like an unmatched line item rather than aggregated), it seeds up to two lines: the project's own total quantity at the weighted-average price actually paid there, and — only if it differs — a second line at the same quantity priced at the most recent company-wide purchase of that material (any project, any supplier), so the user can see whether current costs have moved since this project ran. Line items with no trustworthy match are seeded individually at their own price, with no comparison line. There's no new "approved" status or staging step: the resulting estimate lands on the normal editable estimate page, and the user deleting/adjusting whichever lines they don't want *is* the approval — a formal export/PDF-for-customer step is real future work, not part of this.

**Update (post-MVP, 2026-07-03) — selecting a project always seeds; unified creation path.** Estimate creation previously had two divergent meanings for "reference a project": the `/estimates` picker attached `project_id` as a bare label (seeding nothing), while the project page's button actually seeded from history — producing two estimates that were indistinguishable afterward but built with completely different value. Both entry points now funnel through one internal `seedEstimateFromProject(projectId, name)` (`web/src/app/actions/estimates.ts`): choosing a project on the picker seeds exactly like the project page, and "No project" creates a blank company-wide estimate. So "reference a project" now uniformly means "built from that project's actuals." `project_id` remains nullable and still does nothing after creation beyond provenance/display (it does not scope the estimate's search, which stays company-wide). This resolves only the *creation* ambiguity; the snapshot and optional-project decisions above are unchanged.

**Update (post-MVP, 2026-07-03) — home hub.** The root route (`/`) is now a landing hub (`web/src/app/(app)/page.tsx`) framing the three core actions — search history, new estimate, new project — plus recent projects and estimates, instead of redirecting straight to `/projects`. Post-login lands here (`web/src/lib/supabase/middleware.ts`). It routes into the pages that already own each flow rather than duplicating their forms.
