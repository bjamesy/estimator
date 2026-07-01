-- Estimates. See docs/architecture.md -> Open Questions -> Estimate-building
-- data flow, and docs/data_model.md -> Estimate / EstimateLine.

create table estimates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- Snapshot, not a live reference: source_line_item_id is provenance only
-- and is never re-read after creation. Editing an EstimateLine, or
-- changing the source LineItem's material match, never touches the other.
create table estimate_lines (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references estimates (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  source_line_item_id uuid references line_items (id) on delete set null,
  description text not null,
  quantity numeric(12, 3) not null,
  unit_price numeric(12, 4) not null,
  markup_percent numeric(6, 2) not null default 0,
  total numeric(12, 2) not null,
  created_at timestamptz not null default now()
);

alter table estimates enable row level security;
alter table estimate_lines enable row level security;

create policy "company access" on estimates
  for all using (company_id in (select auth_company_ids()))
  with check (company_id in (select auth_company_ids()));

create policy "company access" on estimate_lines
  for all using (company_id in (select auth_company_ids()))
  with check (company_id in (select auth_company_ids()));
