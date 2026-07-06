-- Contractor credential verification (WSIB clearance, liability
-- insurance, business registration). See docs/v2/02-contractor-verification.md
-- and docs/v2/plans/02-verification-plan.md.
--
-- V1 is "document-on-file": the contractor uploads a certificate, key
-- fields are extracted (reusing the vision LLM pipeline) and correctable
-- by the contractor, and status reflects submitted documents -- NOT an
-- independent guarantee. An independent WSIB cross-check is a possible
-- V2 (plan -> Phase 5).

create table credentials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  credential_type text not null
    check (credential_type in ('wsib', 'liability_insurance', 'business_registration')),
  -- Original certificate in the documents bucket under
  -- {company_id}/credentials/... -- covered by the 0005 company-prefix
  -- storage policy like everything else.
  storage_path text not null,
  -- self_reported: document on file, fields as uploaded/extracted.
  -- verified: reserved for V2 independent cross-checking (unused today).
  -- expired: expiry_date has passed (flipped by the worker sweep).
  status text not null default 'self_reported'
    check (status in ('self_reported', 'verified', 'expired')),
  issued_date date,
  expiry_date date,
  -- Structured so liability coverage can be displayed/filtered cleanly
  -- ("$2M, on file"), not buried in the document.
  coverage_amount numeric(14, 2),
  provider text,
  -- Raw vision-LLM output for this certificate, kept like
  -- ExtractionResult is for invoices. The typed columns above are the
  -- reviewed/corrected values; this is the durable machine reading.
  extraction_result jsonb,
  -- When extraction last ran (null = still pending or never ran).
  last_checked_at timestamptz,
  -- Expiry reminders sent so far: 0 none, 1 = 30-day, 2 = 14-day,
  -- 3 = 1-day. The sweep sends a reminder when the current window's
  -- stage exceeds this and then records it -- each stage fires once.
  expiry_reminders_sent int not null default 0,
  -- Renewal keeps history: uploading a replacement supersedes the old
  -- row instead of deleting it (a certificate that was on file is a
  -- fact worth retaining).
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);

-- One ACTIVE credential per type per company; superseded rows are history.
create unique index credentials_active_per_type
  on credentials (company_id, credential_type)
  where superseded_at is null;

alter table credentials enable row level security;

create policy "company access" on credentials
  for all using (company_id in (select auth_company_ids()))
  with check (company_id in (select auth_company_ids()));
