-- Company-wide search across confirmed purchases. See docs/architecture.md
-- -> Open Questions -> Search and indexing.
--
-- security invoker (the default): runs with the calling user's privileges,
-- so RLS on line_items/invoices/projects/suppliers/material_catalog is
-- still enforced per row -- this function adds no scoping of its own
-- beyond what those tables' policies already provide.
create or replace function search_line_items(search_query text)
returns table (
  line_item_id uuid,
  description text,
  sku text,
  quantity numeric,
  unit_price numeric,
  total numeric,
  material_name text,
  project_id uuid,
  project_name text,
  supplier_name text,
  invoice_date date
)
language sql
stable
as $$
  select
    li.id as line_item_id,
    li.description,
    li.sku,
    li.quantity,
    li.unit_price,
    li.total,
    mc.name as material_name,
    p.id as project_id,
    p.name as project_name,
    s.name as supplier_name,
    i.invoice_date
  from line_items li
  join invoices i on i.id = li.invoice_id
  join projects p on p.id = i.project_id
  join suppliers s on s.id = i.supplier_id
  left join material_matches mm on mm.line_item_id = li.id
  left join material_catalog mc on mc.id = mm.material_id
  where
    li.description ilike '%' || search_query || '%'
    or li.sku ilike '%' || search_query || '%'
    or mc.name ilike '%' || search_query || '%'
    or s.name ilike '%' || search_query || '%'
    or p.name ilike '%' || search_query || '%'
  order by i.invoice_date desc nulls last;
$$;
