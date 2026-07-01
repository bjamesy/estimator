-- Company is the root of every company-scoped table (see docs/data_model.md).
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Maps Supabase Auth users to the company/companies they belong to.
-- This is what RLS policies check against, not a company_id claim on the JWT,
-- so membership changes take effect immediately without re-issuing a token.
create table company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

-- Helper used by every company-scoped RLS policy: the set of company_ids
-- the current authenticated user belongs to.
create or replace function auth_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from company_members where user_id = auth.uid();
$$;
