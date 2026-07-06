# Database

Canonical home for all Postgres schema. `web/` and `workers/` are consumers of this schema, not owners — any change lands here first. Schema mirrors [`docs/data_model.md`](../docs/data_model.md); keep the two in sync.

## Migrations

Plain, numbered SQL files in `migrations/`, applied in order:

1. `0001_extensions.sql` — `pgcrypto` for `gen_random_uuid()`
2. `0002_companies_and_membership.sql` — `companies`, `company_members`, and the `auth_company_ids()` helper every RLS policy uses
3. `0003_core_schema.sql` — the rest of the core domain model (projects, documents, invoices, line items, suppliers, material catalog)
4. `0004_rls_policies.sql` — Row Level Security policies (see `docs/architecture.md` → Company Scoping)
5. `0005_storage_bucket.sql` — the `documents` Storage bucket and its access policy
6. `0006_restrict_auth_company_ids_execute.sql` — tightens `auth_company_ids()` execute permissions per a Supabase security advisor finding
7. `0007_search_line_items.sql` — the `search_line_items` SQL function powering company-wide search (see `docs/architecture.md` → Open Questions → Search and indexing)
8. `0008_set_search_line_items_search_path.sql` — fixes a security advisor warning on `search_line_items`
9. `0009_estimates.sql` — `estimates` and `estimate_lines`
10. `0010_data_safety_fixes.sql` — unique constraint on `invoices.document_id`, `CASCADE` → `RESTRICT` on the historical-data FK chain, unique index on `material_catalog (company_id, lower(name))` — see `docs/mvp/implementation_plan.md` → "Post-review fixes"
11. `0011_estimates_project_optional.sql` — makes `estimates.project_id` nullable and changes its FK from `CASCADE` to `SET NULL`, decoupling Estimates from Projects (see `docs/architecture.md` → Open Questions → Estimate-building data flow)
12. `0012_document_content_hash.sql` — adds `documents.content_hash` (SHA-256) with a partial unique index on `(project_id, content_hash)` for per-project upload idempotency (see `docs/data_model.md` → Document)
13. `0013_unique_names.sql` — case-insensitive unique indexes on project names (per company) and estimate names (per project; standalone estimates form their own group via `NULLS NOT DISTINCT`)
14. `0014_document_rejected_status.sql` — adds the `rejected` document status for successfully-processed non-purchase documents (see `docs/architecture.md` → Document Status)
15. `0015_estimate_line_soft_delete.sql` — adds `estimate_lines.deleted_at` so removing an estimate line tombstones it (restorable) instead of hard-deleting
16. `0016_estimate_versions.sql` — `estimate_versions` and `estimate_version_lines`: immutable estimate snapshots with per-line change tracking, the substrate for change orders (see `docs/v2/plans/01-change-orders-plan.md`)
17. `0017_signatures.sql` — `estimate_signatures` (immutable, no update/delete policies) and `client_signing_tokens` (hashed, single-use, expiring) powering the dual-sign change-order lifecycle and the public `/sign/[token]` page
18. `0018_change_order_pdf.sql` — adds `estimate_versions.pdf_storage_path` for the worker-rendered legal PDF of an executed version
19. `0019_notifications.sql` — adds `client_email` and `reminder_sent_at` to `client_signing_tokens` for signing-link emails and the one-reminder-per-chain sweep

## Applying to a Supabase project

Once a Supabase project exists (Phase 0 — see `docs/mvp/implementation_plan.md`):

```bash
# Via the Supabase CLI, pointed at this directory:
supabase link --project-ref <project-ref>
for f in migrations/*.sql; do psql "$SUPABASE_DB_URL" -f "$f"; done
```

Or paste each file into the Supabase Studio SQL editor in order. `SUPABASE_DB_URL` is the connection string from Project Settings → Database.

## Notes

- `suppliers` has no `company_id` and is excluded from company-scoped RLS by design — see `docs/data_model.md` → Supplier.
- All migrations through `0019` have been applied to and verified against a live Supabase project. Any new migration should be applied the same way and added to the list above.
