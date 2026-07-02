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
└── Suppliers

Estimates           (company-wide; consume historical Line Items from any Project;
                      may optionally reference one Project, but never required to)
```

Invoices produce line items. Line items become the company-wide searchable historical knowledge base. Estimates consume that knowledge and may optionally reference a Project, but are not scoped to one.

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
- **Historical accuracy over categorization.** Store what was actually purchased. Material matching (grouping line items under a canonical material) is automatic but never silent — matches are always visible and correctable, and a flagged match never changes the underlying line item or original document.
- **Company-scoped.** All data belongs to one company — no cross-company sharing in MVP.
- **Progressive value.** Every uploaded invoice increases the value of the system; the product compounds through normal business activity.

## Repo Structure

```
web/          Next.js (TypeScript) app -- frontend, server actions, Celery task publisher
workers/      Python + Celery -- extraction pipeline (vision LLM) and material matching (batched LLM call)
database/     Postgres migrations -- canonical schema source, applied to Supabase
docs/         architecture.md, data_model.md (kept current); mvp/ (frozen build-history docs, no longer maintained)
```

Both `web/` and `workers/` need to be running for uploads/confirms to actually process end to end — see the root `README.md`.

## Current State

MVP complete. All phases (0–7) of `docs/mvp/implementation_plan.md` are implemented and verified end-to-end against a live Supabase project: auth/company creation → project + document upload → vision LLM extraction → user confirm → promotion into the historical record → material matching → company-wide search → estimates with historical pricing and markup.

`docs/architecture.md` and `docs/data_model.md` are the current source of truth for system design and schema; both were kept up to date as each phase was built, including the reasoning behind the three decisions that were originally open questions (search approach, material-matching approach, estimate data flow).
