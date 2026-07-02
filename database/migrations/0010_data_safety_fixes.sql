-- Fixes from code review, 2026-07-02. See docs/implementation_plan.md ->
-- "Post-review fixes" for the full list and reasoning.

-- Prevents duplicate invoices from a raced double-confirm (two concurrent
-- confirmDocument calls both passing the status='pending' check before
-- either commits). With this constraint, the second concurrent insert
-- fails cleanly instead of silently succeeding.
alter table invoices add constraint invoices_document_id_key unique (document_id);

-- "Documents are source of truth... always retained" (CLAUDE.md) was not
-- actually enforced -- the FK chain from projects down through documents,
-- extraction_results, invoices, and line_items was all ON DELETE CASCADE,
-- meaning a single DELETE on a project would silently and permanently
-- destroy every document, invoice, and line item beneath it. There is no
-- delete-project feature today, but the schema shouldn't allow it either.
-- Switched to RESTRICT: a project/document/invoice with dependent
-- historical data now cannot be deleted at all (the row must be
-- explicitly cleaned out bottom-up first, which is the right default for
-- data this product exists to preserve).
alter table documents drop constraint documents_project_id_fkey;
alter table documents add constraint documents_project_id_fkey
  foreign key (project_id) references projects (id) on delete restrict;

alter table extraction_results drop constraint extraction_results_document_id_fkey;
alter table extraction_results add constraint extraction_results_document_id_fkey
  foreign key (document_id) references documents (id) on delete restrict;

alter table invoices drop constraint invoices_document_id_fkey;
alter table invoices add constraint invoices_document_id_fkey
  foreign key (document_id) references documents (id) on delete restrict;

alter table invoices drop constraint invoices_project_id_fkey;
alter table invoices add constraint invoices_project_id_fkey
  foreign key (project_id) references projects (id) on delete restrict;

alter table line_items drop constraint line_items_invoice_id_fkey;
alter table line_items add constraint line_items_invoice_id_fkey
  foreign key (invoice_id) references invoices (id) on delete restrict;

alter table material_matches drop constraint material_matches_line_item_id_fkey;
alter table material_matches add constraint material_matches_line_item_id_fkey
  foreign key (line_item_id) references line_items (id) on delete restrict;

-- Backstop against duplicate MaterialCatalog entries for the same
-- material name (e.g. two line items on one invoice both canonicalizing
-- to a not-yet-catalogued "PT 2x8", or a retry after partial failure
-- re-running the matching LLM). Case-insensitive since matching.py's LLM
-- output isn't guaranteed consistent casing. workers/estimator_workers/
-- tasks.py now dedupes in-loop first and falls back to this constraint
-- (catching the conflict and re-fetching) as the last line of defense.
create unique index material_catalog_company_id_lower_name_key
  on material_catalog (company_id, lower(name));
