-- QuickBooks Online invoice push: a per-company OAuth connection plus
-- the ephemeral state used during the OAuth handshake, and a marker on
-- estimate_versions recording that a version has been pushed.

create table company_quickbooks_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade unique,
  realm_id text not null,
  -- base64(iv + ciphertext + auth tag), AES-256-GCM encrypted/decrypted
  -- in web/src/lib/quickbooks.ts, keyed by QBO_TOKEN_ENCRYPTION_KEY.
  -- Application-layer, not pgcrypto -- a leaked refresh token grants
  -- read/write access to a company's real accounting data, a
  -- materially higher-stakes secret than anything else in this schema.
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  default_item_id text,
  connected_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table company_quickbooks_connections enable row level security;
create policy "company access" on company_quickbooks_connections
  for all using (company_id in (select auth_company_ids()))
  with check (company_id in (select auth_company_ids()));

-- Ephemeral OAuth state, same lifecycle shape as phone_otp_requests --
-- short-lived, one row per in-flight "Connect QuickBooks" attempt,
-- consumed (deleted) on callback. Needed because the OAuth round-trip
-- goes through Intuit's own domain -- unlike Google's OAuth callback
-- (web/src/app/auth/callback/route.ts), there's no Supabase session
-- cookie to rely on when the redirect lands back here.
create table quickbooks_oauth_states (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  state text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table quickbooks_oauth_states enable row level security;
create policy "company access" on quickbooks_oauth_states
  for all using (company_id in (select auth_company_ids()))
  with check (company_id in (select auth_company_ids()));

-- Set once a version has been pushed, so the UI can show "already
-- pushed" / link to the QBO invoice instead of allowing a duplicate
-- push. Same append-only, forward-writing treatment as
-- pdf_storage_path on this table.
alter table estimate_versions add column quickbooks_invoice_id text;
