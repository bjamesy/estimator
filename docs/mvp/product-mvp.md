# Product

## Vision

Construction businesses accumulate years of valuable purchasing history, but that knowledge is trapped inside invoices, receipts, PDFs, and filing cabinets.

When estimating a new project, contractors frequently search through old receipts to answer questions like:

- What did I pay for PT 2x8s last year?
- Which supplier did I buy these from?
- How much did a similar deck actually cost?
- What materials did we use on that job?

The goal of this product is to turn historical purchasing documents into a searchable knowledge base that improves estimating over time.

The system does not replace accounting software.

It does not replace project management software.

It becomes the company's historical memory.

---

# Problem

Estimating often relies on memory.

Contractors regularly revisit old invoices to recover:

- historical material prices
- quantities used
- supplier information
- previous project costs

This process is slow, manual, and scales poorly as the business grows.

Historical knowledge exists—but it is trapped inside documents that were never designed to be searched.

---

# Core Value Proposition

> Turn every completed project into a reusable estimating reference.

Every invoice uploaded improves the company's historical knowledge.

Over time, estimating becomes faster, more consistent, and based on real purchasing history rather than memory.

---

# MVP

The MVP focuses on one workflow:

**Organize projects and make historical purchasing data searchable.**

No integrations.

No supplier APIs.

No community marketplace.

No estimating automation beyond historical pricing.

---

# Primary Workflow

## 1. Create a Project

Users create a project.

Example:

- Smith Residence Deck
- Johnson Garage
- Cottage Addition

Projects become containers for purchasing history.

---

## 2. Upload Purchasing Documents

Users upload:

- PDF invoices
- scanned receipts
- photographed receipts

The system extracts:

- supplier
- purchase date
- line items
- quantities
- unit prices
- totals
- invoice metadata

Users confirm extracted data before it is saved. This catches misreads — a garbled quantity, a wrong unit price — before they enter the historical record. The confirmation step is intentionally minimal in the MVP; a richer correction UI comes later.

Original documents are always preserved.

---

## 3. Build Historical Knowledge

Extracted data is normalized into structured records.

Materials are automatically matched to existing materials in the company's catalog — e.g. "PT 2x8 KD", "Pressure Treated 2x8", and "PT Lumber 2x8" all resolve to one searchable material. Matches are surfaced to the user and can be flagged as wrong. Flagging a match never alters the underlying line item or source document — it only changes how that line item is grouped for search.

Example:

```
Project
    ↓

Invoice
    ↓

Line Items
    ↓

Historical Material Database
```

Instead of searching PDFs, users search structured information.

---

## 4. Search Historical Purchases

Users can search by:

- material
- supplier
- project
- SKU
- description

Example:

> Search: PT 2x8

Results:

- Smith Deck
- June 2026
- Hill's Home Building Centre
- Qty: 75
- Unit Price: $28.99

---

## 5. Build Estimates

Users create a new estimate.

Instead of starting from scratch they can:

- search similar historical projects
- reuse historical material lists
- reference historical unit pricing

Historical prices may optionally be adjusted using a configurable markup or inflation factor.

The estimate remains fully editable.

---

# Data Model

```
Project
├── Documents
├── Invoices
├── Suppliers
├── Line Items
└── Estimates
```

Invoices produce line items.

Line items become searchable historical knowledge.

Estimates consume that knowledge.

---

# Product Principles

## Historical Truth

The system stores what was actually purchased.

It does not attempt to predict or optimize purchasing decisions.

Historical accuracy is more valuable than perfect categorization. Material matching is automatic but never silent — matches are always visible and correctable, and a flagged match never changes the underlying line item or original document.

---

## Company Knowledge First

Everything belongs to the company.

There is no sharing between companies in the MVP.

Trust is simple because all data originates from the business itself.

---

## Documents Remain Source of Truth

Structured data is derived from invoices.

Original invoices are always retained and can be opened at any time.

Users should never lose confidence in where extracted information originated.

---

## Progressive Intelligence

The software becomes more valuable over time.

Every uploaded invoice increases:

- searchable pricing history
- supplier history
- project history
- estimating references

The product compounds naturally through normal business activity.

---

# Out of Scope (MVP)

The MVP intentionally excludes:

- accounting integrations
- QuickBooks sync
- supplier integrations
- inventory management
- purchase ordering
- project scheduling
- subcontractor management
- marketplace functionality
- shared templates
- AI-generated estimates
- price prediction

---

# Future Opportunities

Once the project catalogue is established, future versions may include:

## Historical Price Trends

View how material costs change over time.

---

## Supplier Comparisons

Compare historical pricing across suppliers.

---

## Estimate Templates

Generate reusable project templates from completed historical projects.

Templates are derived from real work rather than manually authored.

---

## Community Knowledge

Potential future functionality may allow companies to publish reusable project templates.

This is intentionally postponed until the single-company workflow provides strong standalone value.

---

# Success Metrics

The MVP succeeds if contractors can answer questions like:

- What did I pay for this material last time?
- Which supplier had the best price?
- Have we built a similar project before?
- What materials did we use?
- Can I reuse that project when preparing this estimate?

Eliminating digging through old invoices is the product's primary objective, but it is earned, not guaranteed by v1. Day one, search gets a contractor to the right document faster than manual digging; contractors stop double-checking against the original once the system has shown them, purchase after purchase, that the extracted numbers can be trusted.