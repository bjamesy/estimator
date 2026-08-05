-- Links an EstimateLine to the canonical MaterialCatalog entry it was
-- seeded from (or later linked to), when known. Closes a gap where the two
-- "add from history" paths could disagree on canonical vs. raw invoice-text
-- description for the same real material: seedEstimateFromProject/
-- buildProjectSeedRows used the catalog's canonical name, but
-- addHistoricalLineToEstimate discarded it in favour of the raw line item
-- text. Nullable, on delete set null -- same provenance-only treatment as
-- source_line_item_id (0009_estimates.sql): an EstimateLine is a snapshot,
-- not a live reference, so losing the catalog row degrades the link, it
-- never touches the line's own frozen description/quantity/price.
-- Forward-only: existing rows are left null -- see docs/data_model.md ->
-- EstimateLine.
alter table estimate_lines
  add column material_id uuid references material_catalog (id) on delete set null;

-- No RLS policy change: estimate_lines' existing "company access" policy
-- (0009_estimates.sql) already covers all columns, including this one.

-- search_line_items: add material_id alongside the material_name it
-- already returns, and stop surfacing either for a line item whose match
-- is 'flagged' -- untrustworthy groupings should never be usable to link a
-- new estimate line to a catalog entry (worse than today's status quo: a
-- differently-worded but at-least-correct line). The status filter lives
-- in the LEFT JOIN's ON clause, not WHERE -- WHERE would turn this into an
-- inner join for flagged-match rows and drop those line items from search
-- results entirely, instead of just nulling their material columns.
--
-- CREATE OR REPLACE FUNCTION cannot change an existing function's return
-- shape (adding a column to RETURNS TABLE errors: "cannot change return
-- type of existing function"), so this drops and recreates rather than
-- replaces. That also means 0008's `alter function ... set search_path =
-- public` (applied to the old function object) does not carry over -- it's
-- re-applied inline below, same as auth_company_ids() in
-- 0002_companies_and_membership.sql.
drop function search_line_items(text);

create function search_line_items(search_query text)
returns table (
  line_item_id uuid,
  description text,
  sku text,
  quantity numeric,
  unit_price numeric,
  total numeric,
  material_id uuid,
  material_name text,
  project_id uuid,
  project_name text,
  supplier_name text,
  invoice_date date
)
language sql
stable
set search_path = public
as $$
  select
    li.id as line_item_id,
    li.description,
    li.sku,
    li.quantity,
    li.unit_price,
    li.total,
    mc.id as material_id,
    mc.name as material_name,
    p.id as project_id,
    p.name as project_name,
    s.name as supplier_name,
    i.invoice_date
  from line_items li
  join invoices i on i.id = li.invoice_id
  join projects p on p.id = i.project_id
  join suppliers s on s.id = i.supplier_id
  left join material_matches mm
    on mm.line_item_id = li.id and mm.status = 'proposed'
  left join material_catalog mc on mc.id = mm.material_id
  where
    li.description ilike '%' || search_query || '%'
    or li.sku ilike '%' || search_query || '%'
    or mc.name ilike '%' || search_query || '%'
    or s.name ilike '%' || search_query || '%'
    or p.name ilike '%' || search_query || '%'
  order by i.invoice_date desc nulls last;
$$;
