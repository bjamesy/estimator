# Data Model

Standalone reference for Estimator's current data model — every entity, its fields, and how tables relate. This is the source of truth for schema; `architecture.md` describes process/pipeline behavior and embeds a couple of these schemas inline where useful for that narrative (`DocumentProcessingEvent`, `ExtractionResult`, `Document.status`), but this document reflects their current state too.

Related: [Architecture](./architecture.md), [Product Spec](./mvp/product-mvp.md), [Implementation Plan](./mvp/implementation_plan.md) — `mvp/` is frozen history from the MVP build, no longer maintained

---

## Relationship Diagram

```
Company
├── Project
│   └── Document
│       ├── DocumentProcessingEvent   (1:N — one row per stage attempt/retry)
│       ├── ExtractionResult          (1:N — retained permanently)
│       └── Invoice                   (0/1:1 — promoted on confirm)
│           └── LineItem              (1:N)
│               └── MaterialMatch     (1:1 — links to MaterialCatalog)
├── Estimate                          (1:N — company-scoped; optional FK to Project)
│   ├── EstimateLine                  (1:N — snapshot, optional FK back to a source LineItem)
│   └── EstimateVersion               (1:N — immutable snapshots; substrate for change orders)
│       └── EstimateVersionLine       (1:N — frozen copy of the draft lines at snapshot time)
├── MaterialCatalog                   (1:N — company-scoped canonical materials)
└── CompanySupplier                   (1:N — company's relationship to a Supplier)
        └── Supplier                  (N:1 — global, not company-scoped)
```

`company_id` is denormalized directly onto `Document`, `Invoice`, `LineItem`, `MaterialCatalog`, and `CompanySupplier` (not just reachable via `Project`), so RLS policies and worker-side scoping don't require a join back through the hierarchy. See `architecture.md` → Company Scoping.

`Supplier` is the one entity with no `company_id` — it's a deliberate global exception. See below.

Every FK in the `Project → Document → (ExtractionResult | Invoice → LineItem → MaterialMatch)` chain is `ON DELETE RESTRICT`, not `CASCADE` — a project/document/invoice/line item with dependent historical data cannot be deleted at all. This enforces "documents are source of truth... always retained" at the schema level, not just as a convention; there is no delete-project (or delete-document, delete-invoice, ...) feature in the app today, and the schema doesn't allow one to accidentally destroy historical data if such a feature is ever added without this in mind.

`Estimate.project_id` is a nullable, optional FK to `Project` (`ON DELETE SET NULL`) — unlike the `RESTRICT` chain above, an `Estimate` is not historical purchasing data and isn't required to belong to a project; deleting a project clears the reference on any linked estimates rather than blocking the delete or cascading the estimate away. See `Estimate` below.

---

## Company

```
Company
  id
  name
  created_at
```

---

## Project

```
Project
  id
  company_id      FK → Company
  name            unique per company (case-insensitive)
  status          e.g. "active" | "archived"
  created_at
```

---

## Document

```
Document
  id
  project_id       FK → Project
  company_id       FK → Company
  storage_path     location in Supabase Storage
  status           "pending" | "failed" | "confirmed"
  content_hash     SHA-256 of the file bytes, nullable — unique per project (partial)
  created_at
```

`status` is coarse-grained and terminal-only. The pipeline never writes intermediate status to it — the one exception is terminal failure, which the worker sets directly. See `architecture.md` → Document Status for the full state description.

`content_hash` enforces per-project upload idempotency: a partial unique index on `(project_id, content_hash)` (excluding `failed` documents and null hashes) hard-blocks byte-identical re-uploads within a project, since duplicated confirmed receipts would double quantities in estimate seeding and repeat purchases in search. Failed documents are excluded because re-uploading the identical file is the documented recovery path after terminal failure; pre-migration documents have a null hash and aren't policed. Exact-byte matching only — two different photos of the same physical receipt are different bytes (semantic dedupe is a separate, post-MVP concern).

---

## DocumentProcessingEvent

```
DocumentProcessingEvent
  id
  document_id       FK → Document
  stage             e.g. "fetch" | "extract" | "parse"
  status            "started" | "succeeded" | "failed"
  error_message     null on success; populated on failure
  attempt_number     increments per retry within a stage
  started_at
  finished_at
```

Append-only. One row per stage attempt, including every Celery retry. This is the sole source of fine-grained pipeline progress — `Document.status` does not track it. See `architecture.md` → Extraction Pipeline.

---

## ExtractionResult

```
ExtractionResult
  id
  document_id       FK → Document
  payload           structured JSON (invoice metadata + line items as extracted)
  created_at
```

Written by the worker on the final pipeline stage's success. Retained permanently, even after promotion to `Invoice`/`LineItem` — it's the durable record of raw vision LLM output per document. See `architecture.md` → ExtractionResult and the Confirm Step.

---

## Invoice

```
Invoice
  id
  project_id      FK → Project
  document_id     FK → Document, unique — at most one Invoice per Document
  supplier_id     FK → Supplier
  company_id      FK → Company
  invoice_date
  total
  created_at
```

Created by Next.js when the user confirms an `ExtractionResult`. Never written by the Python worker. The `document_id` unique constraint exists specifically to make a raced double-confirm (two concurrent requests both passing the `status = "pending"` check) fail cleanly on the second insert instead of silently creating two invoices for the same document.

---

## LineItem

```
LineItem
  id
  invoice_id      FK → Invoice
  company_id      FK → Company
  description     raw, as extracted — never overwritten by normalization
  sku             nullable
  quantity
  unit_price
  total
  created_at
```

`description` stays exactly as extracted regardless of material matching. Matching groups a line item under a canonical material without touching this record — see `MaterialMatch` below.

`quantity`/`unit_price`/`total` are `not null` here even though the extraction prompt allows the vision LLM to return `null` for an illegible number. Any line item with a null numeric field is dropped during parsing (`workers/estimator_workers/extraction.py`) before it's ever written to `ExtractionResult`, rather than being promoted with a fabricated value — an unreadable price isn't "what was purchased," so it's more honest to omit that one line item than to record a number that wasn't actually on the invoice.

---

## MaterialCatalog

```
MaterialCatalog
  id
  company_id      FK → Company
  name            canonical material name, unique per company (case-insensitive)
  created_at
```

Company-scoped: what counts as "the same material" is a judgment call each company makes for itself, per the historical-accuracy principle in `mvp/product-mvp.md`. Intentionally asymmetric with `Supplier`, which is global — see below.

`(company_id, lower(name))` is unique. `match_materials` (`workers/estimator_workers/tasks.py`) dedupes by name in-loop first, so this constraint is mainly a backstop for two runs racing (a retry after partial failure, or two invoices confirmed close together) — a conflict there is caught and resolved by re-fetching the existing row rather than failing the task.

---

## MaterialMatch

```
MaterialMatch
  id
  line_item_id      FK → LineItem
  material_id       FK → MaterialCatalog
  status            "proposed" | "flagged"
  created_at
```

Join table between `LineItem` and `MaterialCatalog`. Matching runs after user confirmation, not during extraction — the system auto-proposes a match, and the user can flag it wrong. Flagging is reversible: an "Undo flag" action (`unflagMaterialMatch`, `web/src/app/actions/materials.ts`) sets `status` back to `proposed`, restoring the match to the accepted grouping that material aggregation and estimate seeding count. Flag/unflag is independent metadata on the relationship; it never changes `Document.status`, the `LineItem` record, or the original document.

---

## Supplier

```
Supplier
  id
  name
  address
  phone
  created_at
```

Global entity — the one deliberate exception to company scoping. A supplier like Hill's Home Building Centre is the same real-world business regardless of which company is buying from it, so it's one shared record rather than duplicated per company. Holds only public business identity — never pricing, notes, or anything proprietary to one company's relationship with it. No `company_id`; intentionally outside RLS.

**As actually implemented (Phase 4):** supplier resolution on confirm is a simple case-insensitive exact-name match (`ilike`) against existing `Supplier` rows — not the LLM-based approach material matching ended up using in Phase 5. This means variant phrasings ("Hill's Home Building Centre" vs "Hills Home Building Center") will create near-duplicate `Supplier` rows rather than being recognized as the same business. Known, documented limitation — see `mvp/implementation_plan.md` → Phase 4 "Not yet tested." Applying the same LLM-matching treatment used for materials is the natural fix if this proves to be a real problem in practice.

---

## CompanySupplier

```
CompanySupplier
  id
  company_id        FK → Company
  supplier_id       FK → Supplier
  account_number    nullable
  notes             nullable
  created_at
```

Company-specific data about a supplier relationship. Company-scoped, unlike `Supplier` itself.

---

## Estimate

```
Estimate
  id
  project_id      FK → Project, nullable — optional reference only, not required
  company_id      FK → Company
  name            unique per project, case-insensitive (standalone estimates form
                   their own uniqueness group within the company — NULLS NOT DISTINCT)
  created_at
```

Not scoped to a project — Estimates draw on the company-wide historical knowledge base (`search_line_items` has never been project-scoped) and may optionally reference one `Project` for organizational purposes only. There is no promotion/conversion flow between an `Estimate` and a `Project`: a `Project` holds actual purchasing history (receipts/invoices), while an `Estimate` is a projection that never becomes purchasing history itself. No lifecycle/status field in MVP — an estimate is always an editable draft; there is no finalize/send step.

## EstimateLine

```
EstimateLine
  id
  estimate_id          FK → Estimate
  company_id           FK → Company
  source_line_item_id  FK → LineItem, nullable — provenance only, never re-read after creation
  description          text — copied from the source LineItem, or entered manually if source_line_item_id is null
  quantity
  unit_price
  markup_percent        default 0
  total                 quantity * unit_price * (1 + markup_percent / 100), recalculated on edit
  deleted_at            timestamptz, nullable — non-null tombstones the line (removed but restorable)
  created_at
```

A snapshot, not a live reference. See `architecture.md` → Open Questions → Estimate-building data flow for why: pulling in a historical `LineItem` copies its data into a new `EstimateLine`; editing the estimate line afterward never touches the source, and the source's original invoice/document is unaffected by anything that happens in an estimate built from it.

**Removing a line is a soft delete** (`0015_estimate_line_soft_delete.sql`). `deleteEstimateLine` sets `deleted_at` instead of dropping the row; `restoreEstimateLine` clears it. A tombstoned line is retained and shown struck-through under "Removed lines" with a Restore button, but is excluded from the estimate total and any export — both count only rows where `deleted_at is null`. Newly inserted lines are always active (`deleted_at` null).

## EstimateVersion

```
EstimateVersion
  id
  estimate_id            FK → Estimate, RESTRICT
  company_id             FK → Company, RESTRICT
  parent_version_id      FK → EstimateVersion, RESTRICT, nullable — previous version; null on the original
  version_number         int — monotonic per estimate; unique (estimate_id, version_number)
  status                 "draft" | "pending_contractor_signature" | "pending_client_signature"
                          | "executed" | "superseded"
  total                  sum of non-removed line totals, frozen at snapshot time
  pct_change_from_root   vs. the version 1 total; null on the root — >= 10 is the Ontario CPA
                          threshold requiring documented client consent
  contractor_signed_at   timestamptz, nullable (signing lands in change-orders Phase 3)
  client_signed_at       timestamptz, nullable
  created_at
```

An immutable snapshot of the estimate's active draft lines — the substrate for change orders (`docs/v2/plans/01-change-orders-plan.md`, `0016_estimate_versions.sql`). The live `Estimate`/`EstimateLine` stay the editable working draft; `snapshotEstimateVersion` (`web/src/app/actions/change-orders.ts`) freezes them into a new version. Append-only: after creation, only `status` and the signature timestamps ever change, and only forward through the lifecycle. The whole chain is `ON DELETE RESTRICT` — a signed change order is a legal artifact, same retention discipline as the `Document → Invoice → LineItem` chain. A new snapshot marks the previous version `superseded` unless it was `executed` — executed versions are never touched. A snapshot identical to the latest version is refused.

## EstimateVersionLine

```
EstimateVersionLine
  id
  estimate_version_id     FK → EstimateVersion, RESTRICT
  company_id              FK → Company, RESTRICT
  source_estimate_line_id FK → EstimateLine, SET NULL — which draft line this froze; the diff key
  source_line_item_id     FK → LineItem, SET NULL — provenance carried through from the draft line
  description
  quantity
  unit_price
  markup_percent
  total
  change_kind             "unchanged" | "added" | "modified" | "removed" — vs. the parent version
  created_at
```

Lines are matched across versions by `source_estimate_line_id` (which draft line they froze), not by description. `change_kind` is computed at snapshot time against the parent version's non-removed lines; on the root version every line is `unchanged` (the root is the baseline). `removed` rows are lines that existed in the parent but not in this snapshot — carried into the new version with the parent's frozen values so a change order is self-contained, shown struck-through, and excluded from the version's `total`.
