# Database

Canonical home for all Postgres schema. `web/` and `workers/` are consumers of this schema, not owners — any change lands here first. Schema mirrors [`docs/data_model.md`](../docs/data_model.md); keep the two in sync.

## Migrations

Plain, numbered SQL files in `migrations/`, applied in order:

1. `0001_extensions.sql` — `pgcrypto` for `gen_random_uuid()`
2. `0002_companies_and_membership.sql` — `companies`, `company_members`, and the `auth_company_ids()` helper every RLS policy uses
3. `0003_core_schema.sql` — the rest of the domain model
4. `0004_rls_policies.sql` — Row Level Security policies (see `docs/architecture.md` → Company Scoping)
5. `0005_storage_bucket.sql` — the `documents` Storage bucket and its access policy

## Applying to a Supabase project

Once a Supabase project exists (Phase 0 — see `docs/implementation_plan.md`):

```bash
# Via the Supabase CLI, pointed at this directory:
supabase link --project-ref <project-ref>
psql "$SUPABASE_DB_URL" -f migrations/0001_extensions.sql
psql "$SUPABASE_DB_URL" -f migrations/0002_companies_and_membership.sql
psql "$SUPABASE_DB_URL" -f migrations/0003_core_schema.sql
psql "$SUPABASE_DB_URL" -f migrations/0004_rls_policies.sql
psql "$SUPABASE_DB_URL" -f migrations/0005_storage_bucket.sql
```

Or paste each file into the Supabase Studio SQL editor in order. `SUPABASE_DB_URL` is the connection string from Project Settings → Database.

## Notes

- `estimates` is intentionally not created yet — its schema is an open question. See `docs/architecture.md` → Open Questions → Estimate-building data flow.
- `suppliers` has no `company_id` and is excluded from company-scoped RLS by design — see `docs/data_model.md` → Supplier.
