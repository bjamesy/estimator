-- Estimate versions: immutable snapshots of an estimate's active lines,
-- the substrate for change orders and Ontario CPA 10%-overage compliance.
-- See docs/v2/01-change-orders-compliance.md and
-- docs/v2/plans/01-change-orders-plan.md -> Phase 1.
--
-- The live estimates/estimate_lines tables remain the editable working
-- draft. Snapshotting copies the draft's active lines into a new
-- estimate_versions row + estimate_version_lines rows. Versions are
-- append-only: after creation, the only columns that ever change are
-- status and the two signed_at timestamps, and only forward through the
-- lifecycle (enforced in the server actions, like the rest of the app's
-- write discipline). Everything in the chain is ON DELETE RESTRICT --
-- a signed change order is a legal artifact and follows the same
-- retention discipline as the Document -> Invoice -> LineItem chain
-- (see 0010_data_safety_fixes.sql).

create table estimate_versions (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references estimates (id) on delete restrict,
  company_id uuid not null references companies (id) on delete restrict,
  -- Previous version; null on the original (version_number = 1).
  parent_version_id uuid references estimate_versions (id) on delete restrict,
  version_number int not null,
  -- draft: snapshotted, signing not started (Phase 1 stops here; the
  -- pending_*/executed transitions arrive with signatures in Phase 3).
  -- superseded: a newer snapshot was taken before this one was executed.
  -- executed versions are never superseded -- they happened.
  status text not null default 'draft'
    check (status in (
      'draft',
      'pending_contractor_signature',
      'pending_client_signature',
      'executed',
      'superseded'
    )),
  -- Sum of non-removed line totals, frozen at snapshot time.
  total numeric(12, 2) not null,
  -- vs. the root (version_number = 1) total; null on the root itself.
  -- >= 10 is the Ontario CPA threshold requiring documented client
  -- consent -- computed and stored here so the flag survives even if
  -- the root version's rows were somehow recomputed differently later.
  pct_change_from_root numeric(8, 2),
  contractor_signed_at timestamptz,
  client_signed_at timestamptz,
  created_at timestamptz not null default now(),
  -- Backstops two concurrent snapshots racing past the max(version_number)
  -- read -- the second insert fails cleanly instead of creating two
  -- versions with the same number (same trick as invoices.document_id).
  unique (estimate_id, version_number)
);

create table estimate_version_lines (
  id uuid primary key default gen_random_uuid(),
  estimate_version_id uuid not null references estimate_versions (id) on delete restrict,
  company_id uuid not null references companies (id) on delete restrict,
  -- Which draft line this froze. This is the diff key: lines are matched
  -- across versions by the draft estimate_line they came from, which is
  -- far more reliable than matching on description. set null (not
  -- restrict) because draft lines are working copies, not the artifact --
  -- losing the link degrades future diffs to "added", it doesn't damage
  -- this version's frozen content.
  source_estimate_line_id uuid references estimate_lines (id) on delete set null,
  -- Provenance carried through from the draft line (see estimate_lines).
  source_line_item_id uuid references line_items (id) on delete set null,
  description text not null,
  quantity numeric(12, 3) not null,
  unit_price numeric(12, 4) not null,
  markup_percent numeric(6, 2) not null default 0,
  total numeric(12, 2) not null,
  -- vs. the parent version, computed at snapshot time. 'removed' rows
  -- are lines that existed in the parent but not in this snapshot --
  -- included (with the parent's frozen values) so a change order is
  -- self-contained, but excluded from the version's total. On the root
  -- version every line is 'unchanged' (the root is the baseline).
  change_kind text not null
    check (change_kind in ('unchanged', 'added', 'modified', 'removed')),
  created_at timestamptz not null default now()
);

create index estimate_versions_estimate_id_idx
  on estimate_versions (estimate_id);
create index estimate_version_lines_version_id_idx
  on estimate_version_lines (estimate_version_id);

alter table estimate_versions enable row level security;
alter table estimate_version_lines enable row level security;

create policy "company access" on estimate_versions
  for all using (company_id in (select auth_company_ids()))
  with check (company_id in (select auth_company_ids()));

create policy "company access" on estimate_version_lines
  for all using (company_id in (select auth_company_ids()))
  with check (company_id in (select auth_company_ids()));
