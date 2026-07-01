-- Schema mirrors docs/data_model.md. Keep the two in sync when either changes.

create table projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);

-- Supplier is a deliberate exception to company scoping: one global record
-- per real-world business, shared across companies. See docs/architecture.md
-- -> Company Scoping, and docs/data_model.md -> Supplier.
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  phone text,
  created_at timestamptz not null default now()
);

-- Company-specific data about a supplier relationship. Company-scoped,
-- unlike suppliers itself.
create table company_suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  supplier_id uuid not null references suppliers (id) on delete cascade,
  account_number text,
  notes text,
  created_at timestamptz not null default now(),
  unique (company_id, supplier_id)
);

-- company_id is denormalized onto documents (and everything below it) so
-- RLS and worker-side scoping never require a join back through projects.
create table documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending', 'failed', 'confirmed')),
  created_at timestamptz not null default now()
);

-- Append-only pipeline progress log. One row per stage attempt, including
-- every Celery retry. documents.status never reflects intermediate stages.
-- See docs/architecture.md -> Extraction Pipeline.
create table document_processing_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents (id) on delete cascade,
  stage text not null,
  status text not null check (status in ('started', 'succeeded', 'failed')),
  error_message text,
  attempt_number integer not null default 1,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Worker output; retained permanently even after promotion to
-- invoices/line_items. See docs/architecture.md -> ExtractionResult and the
-- Confirm Step.
create table extraction_results (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents (id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  document_id uuid not null references documents (id) on delete cascade,
  supplier_id uuid not null references suppliers (id),
  company_id uuid not null references companies (id) on delete cascade,
  invoice_date date,
  total numeric(12, 2),
  created_at timestamptz not null default now()
);

create table line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  description text not null,
  sku text,
  quantity numeric(12, 3) not null,
  unit_price numeric(12, 4) not null,
  total numeric(12, 2) not null,
  created_at timestamptz not null default now()
);

-- Company-scoped canonical materials. What counts as "the same material" is
-- a judgment call each company makes for itself (see docs/product-mvp.md).
create table material_catalog (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- Join table between line_items and material_catalog. Matching runs after
-- user confirmation, not during extraction. Flagging never touches
-- line_items or the original document -- only this row's status.
create table material_matches (
  id uuid primary key default gen_random_uuid(),
  line_item_id uuid not null references line_items (id) on delete cascade,
  material_id uuid not null references material_catalog (id) on delete cascade,
  status text not null default 'proposed' check (status in ('proposed', 'flagged')),
  created_at timestamptz not null default now(),
  unique (line_item_id)
);

-- NOTE: `estimates` is intentionally not created yet. Its schema is an open
-- question -- see docs/architecture.md -> Open Questions -> Estimate-building
-- data flow, and docs/implementation_plan.md -> Phase 7.
