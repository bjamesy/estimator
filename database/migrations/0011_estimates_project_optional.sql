-- Estimates were required to belong to a Project (project_id not null,
-- on delete cascade). Product decision: Projects hold actual purchasing
-- history (receipts/invoices -- ground truth per "documents are source
-- of truth"), while Estimates are projections that draw on the
-- company-wide historical knowledge base (search_line_items has always
-- been company-scoped, never project-scoped -- see
-- docs/architecture.md -> Open Questions -> Search and indexing). The
-- two aren't meaningfully coupled; project_id becomes an optional
-- reference, not a required parent, and there is no promotion/
-- conversion flow from Estimate to Project.
alter table estimates alter column project_id drop not null;

-- CASCADE -> SET NULL, not RESTRICT (unlike the historical-data FK
-- chain converted in 0010_data_safety_fixes.sql). An Estimate is not
-- historical purchasing data, so it should survive its linked
-- Project's deletion -- it just loses the optional reference, rather
-- than being destroyed (the old CASCADE behavior) or blocking the
-- delete (RESTRICT, the treatment given to Document/Invoice/LineItem).
alter table estimates drop constraint estimates_project_id_fkey;
alter table estimates add constraint estimates_project_id_fkey
  foreign key (project_id) references projects (id) on delete set null;
