-- Non-purchase documents get a distinct terminal state. The extraction
-- pipeline now classifies every upload (see
-- workers/estimator_workers/extraction.py): a document that isn't a record
-- of an actual completed purchase -- a quote, a purchase order, a
-- statement, or a non-purchasing file like a resume or blank page -- is
-- 'rejected' rather than promoted.
--
-- 'rejected' is deliberately NOT 'failed'. 'failed' means a pipeline error
-- the user should retry (re-upload); 'rejected' means the pipeline ran
-- successfully and correctly determined there is nothing to extract. The
-- review page explains a rejection calmly (with rejection_reason) and
-- offers no Confirm, instead of showing a red "processing failed" error.
alter table documents drop constraint documents_status_check;
alter table documents
  add constraint documents_status_check
  check (status in ('pending', 'failed', 'confirmed', 'rejected'));

-- The model's one-sentence explanation of what the document appears to be
-- ("This is a supplier quote, not a completed purchase."). Only set when
-- status = 'rejected'; null otherwise.
alter table documents add column rejection_reason text;

-- Re-uploading a rejected file must stay allowed -- the user may disagree
-- with the classification or upload a clearer scan -- exactly the rationale
-- that already excludes 'failed' from the idempotency index (see
-- 0012_document_content_hash.sql). Recreate the partial unique index to
-- exclude both non-promoting terminal states.
drop index documents_project_id_content_hash_key;
create unique index documents_project_id_content_hash_key
  on documents (project_id, content_hash)
  where status not in ('failed', 'rejected') and content_hash is not null;
