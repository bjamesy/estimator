# Data Model

Standalone reference for Estimator's current data model — every entity, its fields, and how tables relate. This is the source of truth for schema; `architecture.md` describes process/pipeline behavior and embeds a couple of these schemas inline where useful for that narrative (`DocumentProcessingEvent`, `ExtractionResult`, `Document.status`), but this document reflects their current state too.

Related: [Architecture](./architecture.md), [Product Spec](./product-mvp.md)

---

## Relationship Diagram

```
Company
├── Project
│   ├── Document
│   │   ├── DocumentProcessingEvent   (1:N — one row per stage attempt/retry)
│   │   ├── ExtractionResult          (1:N — retained permanently)
│   │   └── Invoice                   (0/1:1 — promoted on confirm)
│   │       └── LineItem              (1:N)
│   │           └── MaterialMatch     (1:1 — links to MaterialCatalog)
│   └── Estimate                      (1:N)
│       └── EstimateLine               (1:N — snapshot, optional FK back to a source LineItem)
├── MaterialCatalog                   (1:N — company-scoped canonical materials)
└── CompanySupplier                   (1:N — company's relationship to a Supplier)
        └── Supplier                  (N:1 — global, not company-scoped)
```

`company_id` is denormalized directly onto `Document`, `Invoice`, `LineItem`, `MaterialCatalog`, and `CompanySupplier` (not just reachable via `Project`), so RLS policies and worker-side scoping don't require a join back through the hierarchy. See `architecture.md` → Company Scoping.

`Supplier` is the one entity with no `company_id` — it's a deliberate global exception. See below.

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
  name
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
  created_at
```

`status` is coarse-grained and terminal-only. The pipeline never writes intermediate status to it — the one exception is terminal failure, which the worker sets directly. See `architecture.md` → Document Status for the full state description.

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
  document_id     FK → Document
  supplier_id     FK → Supplier
  company_id      FK → Company
  invoice_date
  total
  created_at
```

Created by Next.js when the user confirms an `ExtractionResult`. Never written by the Python worker.

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

---

## MaterialCatalog

```
MaterialCatalog
  id
  company_id      FK → Company
  name            canonical material name
  created_at
```

Company-scoped: what counts as "the same material" is a judgment call each company makes for itself, per the historical-accuracy principle in `product-mvp.md`. Intentionally asymmetric with `Supplier`, which is global — see below.

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

Join table between `LineItem` and `MaterialCatalog`. Matching runs after user confirmation, not during extraction — the system auto-proposes a match, and the user can flag it wrong. Flagging is independent metadata on the relationship; it never changes `Document.status`, the `LineItem` record, or the original document.

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

Because any company's user could otherwise create near-duplicate suppliers ("Hill's Home Building Centre" vs "Hills Home Building Center"), Supplier creation during invoice extraction needs the same auto-match-and-confirm treatment as materials — folded into the open material-matching question in `architecture.md`, not a separate mechanism.

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
  project_id      FK → Project
  company_id      FK → Company
  name            e.g. "Initial Estimate", "Rev 2"
  created_at
```

Scoped to a project. No lifecycle/status field in MVP — an estimate is always an editable draft; there is no finalize/send step.

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
  created_at
```

A snapshot, not a live reference. See `architecture.md` → Open Questions → Estimate-building data flow for why: pulling in a historical `LineItem` copies its data into a new `EstimateLine`; editing the estimate line afterward never touches the source, and the source's original invoice/document is unaffected by anything that happens in an estimate built from it.
