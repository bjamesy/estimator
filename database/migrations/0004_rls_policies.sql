-- Row Level Security is the primary company-scoping enforcement boundary
-- (see docs/architecture.md -> Company Scoping). Every table is covered
-- except `suppliers`, which is a deliberate global exception.

alter table companies enable row level security;
alter table company_members enable row level security;
alter table projects enable row level security;
alter table documents enable row level security;
alter table document_processing_events enable row level security;
alter table extraction_results enable row level security;
alter table suppliers enable row level security;
alter table company_suppliers enable row level security;
alter table invoices enable row level security;
alter table line_items enable row level security;
alter table material_catalog enable row level security;
alter table material_matches enable row level security;

-- companies / company_members: read-only for members. Creation happens
-- through a server-side route using the service role key, which bypasses
-- RLS, so a company and its first membership row are created atomically.
create policy "select own companies" on companies
  for select using (id in (select auth_company_ids()));

create policy "select own memberships" on company_members
  for select using (user_id = auth.uid());

-- Directly company-scoped tables: company_id in auth_company_ids() covers
-- select/insert/update/delete uniformly.
create policy "company access" on projects
  for all using (company_id in (select auth_company_ids()))
  with check (company_id in (select auth_company_ids()));

create policy "company access" on documents
  for all using (company_id in (select auth_company_ids()))
  with check (company_id in (select auth_company_ids()));

create policy "company access" on invoices
  for all using (company_id in (select auth_company_ids()))
  with check (company_id in (select auth_company_ids()));

create policy "company access" on line_items
  for all using (company_id in (select auth_company_ids()))
  with check (company_id in (select auth_company_ids()));

create policy "company access" on material_catalog
  for all using (company_id in (select auth_company_ids()))
  with check (company_id in (select auth_company_ids()));

create policy "company access" on company_suppliers
  for all using (company_id in (select auth_company_ids()))
  with check (company_id in (select auth_company_ids()));

-- Tables without a denormalized company_id: scope through their parent.
create policy "company access via document" on document_processing_events
  for all using (
    exists (
      select 1 from documents d
      where d.id = document_processing_events.document_id
        and d.company_id in (select auth_company_ids())
    )
  );

create policy "company access via document" on extraction_results
  for all using (
    exists (
      select 1 from documents d
      where d.id = extraction_results.document_id
        and d.company_id in (select auth_company_ids())
    )
  );

create policy "company access via line item" on material_matches
  for all using (
    exists (
      select 1 from line_items li
      where li.id = material_matches.line_item_id
        and li.company_id in (select auth_company_ids())
    )
  );

-- suppliers: global directory. Any authenticated user can read and create
-- (a new company's first invoice from a new supplier needs to create the
-- record), but not update/delete -- one company should not be able to rename
-- or remove a record another company depends on. Dedup/matching on create is
-- an open question, same mechanism as material matching
-- (docs/architecture.md -> Open Questions -> Material-matching implementation).
create policy "read suppliers" on suppliers
  for select to authenticated using (true);

create policy "create suppliers" on suppliers
  for insert to authenticated with check (true);
