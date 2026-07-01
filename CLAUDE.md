# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **Estimator** — a tool for construction businesses that turns historical purchasing documents (invoices, receipts, PDFs) into a searchable knowledge base used for project estimating.

The core problem: contractors dig through old invoices to answer questions like "what did I pay for PT 2x8s last year?" The product replaces that manual search with structured, queryable data.

**This is not** accounting software or project management software. It is the company's historical purchasing memory.

## Domain Model

```
Project
├── Documents       (original uploaded files — always preserved)
├── Invoices        (extracted from documents)
│   └── Line Items  (supplier, date, material, qty, unit price, total)
├── Suppliers
└── Estimates       (consume line items as historical references)
```

Invoices produce line items. Line items become the searchable historical knowledge base. Estimates consume that knowledge.

## MVP Scope

The MVP delivers one workflow: **upload purchasing documents → extract structured data → search historical purchases → build estimates from that history.**

Explicitly out of scope for MVP:
- Accounting/QuickBooks integrations
- Supplier integrations or inventory management
- AI-generated estimates or price prediction
- Multi-company sharing or marketplace features
- Project scheduling or subcontractor management

## Product Principles

- **Documents are source of truth.** Structured data is always derived from originals; originals are always retained.
- **Historical accuracy over categorization.** Store what was actually purchased; don't try to normalize or predict.
- **Company-scoped.** All data belongs to one company — no cross-company sharing in MVP.
- **Progressive value.** Every uploaded invoice increases the value of the system; the product compounds through normal business activity.

## Current State

Early pre-code stage. `docs/product-mvp.md` contains the full product specification. No application code exists yet.
