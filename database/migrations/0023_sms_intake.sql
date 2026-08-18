-- SMS/MMS receipt intake (docs/v3/... plan). A contractor can text a
-- photo of a receipt to a shared Twilio number instead of uploading
-- through the web app. The document has no project at the moment it's
-- received -- unlike estimates (0011_estimates_project_optional.sql),
-- documents have always required one. Same reasoning applies here: the
-- historical purchasing record is company-wide, not always
-- project-scoped at the moment of capture. A project is resolved later,
-- at confirm time (see confirmDocument).
--
-- The FK stays ON DELETE RESTRICT (set in 0010_data_safety_fixes.sql)
-- unchanged -- nullability doesn't affect delete behavior, a null
-- project_id simply references nothing.
alter table documents alter column project_id drop not null;

-- documents_project_id_content_hash_key (0012_document_content_hash.sql,
-- adjusted by 0014_document_rejected_status.sql to also exclude
-- 'rejected') is a unique index on (project_id, content_hash) --
-- Postgres never treats NULL = NULL, so two SMS uploads of the same
-- photo (a contractor texting twice, or a Twilio delivery retry hitting
-- the webhook twice) would silently both get inserted once project_id
-- can be null. This covers that gap specifically for the null-project
-- case, scoped by company_id instead. Same status exclusion as the
-- current (post-0014) version of that index -- re-uploading a failed or
-- rejected file must stay allowed.
create unique index documents_company_id_content_hash_unassigned_key
  on documents (company_id, content_hash)
  where project_id is null and status not in ('failed', 'rejected') and content_hash is not null;

-- Durable, verified phone -> company routing for the inbound Twilio
-- webhook. One row per trusted number; a number can be claimed by only
-- one company (global unique constraint) -- verification (phone_otp_requests
-- below) is what earns a row here.
create table company_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  phone_number text not null unique, -- E.164, e.g. +15551234567
  created_by uuid not null references auth.users (id) on delete cascade,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Ephemeral OTP challenge state -- deliberately a separate table from
-- company_phone_numbers, not a nullable verified_at column on one
-- merged table: many short-lived rows per registration attempt
-- (retries, wrong codes, expiries) vs. one durable row per trusted
-- number, and this table is written by the requesting user's own
-- RLS-scoped session while company_phone_numbers is read by the
-- unauthenticated Twilio webhook via the admin client.
create table phone_otp_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  phone_number text not null,
  code_hash text not null, -- sha256 of the 6-digit code, never store it raw
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table company_phone_numbers enable row level security;
alter table phone_otp_requests enable row level security;

-- Same "directly company-scoped table" policy shape as every other
-- table in 0004_rls_policies.sql.
create policy "company access" on company_phone_numbers
  for all using (company_id in (select auth_company_ids()))
  with check (company_id in (select auth_company_ids()));

create policy "company access" on phone_otp_requests
  for all using (company_id in (select auth_company_ids()))
  with check (company_id in (select auth_company_ids()));
