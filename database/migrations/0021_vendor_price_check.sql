-- Vendor price verification (spot-check). See docs/v2/05-vendor-price-check.md
-- and docs/v2/plans/05-vendor-price-check-plan.md.
--
-- Deliberately narrow: one saved vendor product URL per estimate line,
-- re-checked by re-fetching that exact URL -- no search/matching, no
-- general pricing engine. A check NEVER silently changes the line's
-- price; it only records what the vendor page said, and the contractor
-- decides whether to apply it.

-- The saved product URL, and the last time a check CONFIRMED the line's
-- price (the "price last verified on [date]" stamp -- carried into
-- version snapshots and the change-order PDF for the audit trail).
alter table estimate_lines add column vendor_product_url text;
alter table estimate_lines add column price_verified_at timestamptz;
alter table estimate_version_lines add column price_verified_at timestamptz;

-- Append-only history of checks; the latest row per line is the current
-- state. fetched_price is null when the fetch/extraction failed
-- (outcome 'unverifiable' -- the estimate keeps its price, never errors).
create table vendor_price_checks (
  id uuid primary key default gen_random_uuid(),
  estimate_line_id uuid not null references estimate_lines (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  vendor_product_url text not null,
  -- The line's unit_price at check time, so the comparison the outcome
  -- was based on stays reproducible even after the line is edited.
  estimate_price numeric(12, 4) not null,
  fetched_price numeric(12, 4),
  outcome text not null check (outcome in ('confirmed', 'changed', 'unverifiable')),
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index vendor_price_checks_line_idx
  on vendor_price_checks (estimate_line_id, checked_at desc);

alter table vendor_price_checks enable row level security;

-- Written by the worker (service role, bypasses RLS); read by the app.
-- select-only for authenticated: check history is a record of what the
-- vendor page said at a moment in time, not something to edit.
create policy "company read" on vendor_price_checks
  for select using (company_id in (select auth_company_ids()));
