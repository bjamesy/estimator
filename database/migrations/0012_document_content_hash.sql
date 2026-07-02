-- Per-project upload idempotency. uploadDocument computes a SHA-256 of
-- the file bytes and hard-blocks a byte-identical re-upload within the
-- same project (duplicated confirmed receipts double quantities in
-- estimate seeding and repeat purchases in company-wide search). The
-- app checks first so it can name the existing document's status in the
-- error; this index is the race backstop (same check-then-constraint
-- pattern as invoices_document_id_key in 0010).
--
-- Deliberately partial:
-- - status <> 'failed': re-uploading the identical file is the
--   documented recovery path after terminal failure (see
--   docs/architecture.md -> Retry and failure), so a failed document
--   must not block it.
-- - content_hash is not null: documents uploaded before this migration
--   have no hash and are not retroactively policed. A backfill script
--   hashing the stored originals can tighten this later if wanted.
--
-- Same file in two *different* projects stays allowed by design (e.g.
-- an invoice legitimately spanning two jobs). Content hashing only
-- catches exact byte duplicates -- two different photos of the same
-- physical receipt are different bytes and need a semantic layer
-- (post-MVP) to catch.
alter table documents add column content_hash text;

create unique index documents_project_id_content_hash_key
  on documents (project_id, content_hash)
  where status <> 'failed' and content_hash is not null;
