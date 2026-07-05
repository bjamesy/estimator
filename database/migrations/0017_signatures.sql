-- Signatures + client signing tokens for change orders. See
-- docs/v2/plans/01-change-orders-plan.md -> Phase 3.
--
-- Lifecycle (enforced in the server actions): a 'draft' version is signed
-- by the contractor (contractor signature row + contractor_signed_at +
-- status -> 'pending_client_signature', and a signing token is minted),
-- then by the client through the public /sign/[token] page (client
-- signature row + client_signed_at + status -> 'executed'). Once
-- executed, the version and its signatures are fully immutable.
-- 'pending_contractor_signature' stays defined on estimate_versions for
-- a future prepare-then-sign split (e.g. office admin prepares, owner
-- signs) but is unused by this flow.

create table estimate_signatures (
  id uuid primary key default gen_random_uuid(),
  estimate_version_id uuid not null references estimate_versions (id) on delete restrict,
  company_id uuid not null references companies (id) on delete restrict,
  signer_role text not null check (signer_role in ('contractor', 'client')),
  signer_name text not null,
  signer_email text,
  -- v1 in-house capture: the typed full name the signer adopted as their
  -- signature. Kept as opaque text so a later drawn-signature capture
  -- (data URI) or certified e-signature provider reference can live in
  -- the same column -- the capture mechanism is isolated behind
  -- web/src/lib/signatures.ts precisely so it can be swapped.
  signature_data text not null,
  -- Audit metadata (spec: "IP/device metadata optional"). Best-effort
  -- from request headers; nullable because a proxy may strip them.
  ip_address text,
  user_agent text,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- One signature per role per version. Also the atomic backstop against
  -- a raced double-sign: the second insert fails cleanly.
  unique (estimate_version_id, signer_role)
);

-- Tokenized, no-account client signing. The raw token appears only in
-- the signing URL handed to the client; the database stores its SHA-256
-- hash, so a database read can never recover a usable signing link.
-- The public signing page and action look tokens up through the
-- server-side admin client (service key) -- there are deliberately no
-- anon RLS policies here or anywhere.
create table client_signing_tokens (
  id uuid primary key default gen_random_uuid(),
  estimate_version_id uuid not null references estimate_versions (id) on delete restrict,
  company_id uuid not null references companies (id) on delete restrict,
  token_hash text not null unique,
  expires_at timestamptz not null,
  -- Single-use: set atomically when the client signs ("claim"), checked
  -- with `where used_at is null` so a raced double-submit loses cleanly.
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index estimate_signatures_version_idx
  on estimate_signatures (estimate_version_id);
create index client_signing_tokens_version_idx
  on client_signing_tokens (estimate_version_id);

alter table estimate_signatures enable row level security;
alter table client_signing_tokens enable row level security;

-- Signatures are the legal artifact, so unlike the blanket `for all`
-- company policies elsewhere, there are NO update or delete policies:
-- once a signature row exists, nobody -- including the contractor's own
-- authenticated session -- can alter or remove it through the API. The
-- client's signature is inserted via the admin client (bypasses RLS),
-- so the insert policy below only needs to cover the contractor's own
-- signature.
create policy "company read" on estimate_signatures
  for select using (company_id in (select auth_company_ids()));
create policy "company insert" on estimate_signatures
  for insert with check (company_id in (select auth_company_ids()));

-- Tokens are operational, not legal artifacts: the contractor may mint
-- and revoke (delete) unused links, but never mutate one -- no update
-- policy, so used_at/expires_at can't be tampered with to resurrect a
-- consumed or expired link.
create policy "company read" on client_signing_tokens
  for select using (company_id in (select auth_company_ids()));
create policy "company insert" on client_signing_tokens
  for insert with check (company_id in (select auth_company_ids()));
create policy "company delete" on client_signing_tokens
  for delete using (company_id in (select auth_company_ids()));
