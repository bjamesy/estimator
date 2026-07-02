import base64
from typing import Callable, TypeVar

from celery import Task, chain
from postgrest.exceptions import APIError

from estimator_workers.celery_app import app
from estimator_workers.events import finish_event, mark_document_failed, start_event
from estimator_workers.extraction import (
    SUPPORTED_MIME_TYPES,
    call_vision_llm,
    parse_extraction_json,
)
from estimator_workers.matching import match_line_items_to_catalog
from estimator_workers.supabase_client import get_supabase

POSTGRES_UNIQUE_VIOLATION = "23505"

MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 10

T = TypeVar("T")


def _run_stage(task: Task, document_id: str, stage: str, fn: Callable[[], T]) -> T:
    """Wrap a stage's work with event logging, retry, and terminal failure
    handling. One DocumentProcessingEvent row per attempt (including
    retries); Document.status is only ever written here on terminal
    failure. See docs/architecture.md -> Extraction Pipeline."""
    attempt_number = task.request.retries + 1
    event_id = start_event(document_id, stage, attempt_number)
    try:
        result = fn()
    except Exception as exc:
        finish_event(event_id, "failed", str(exc))
        if task.request.retries >= task.max_retries:
            mark_document_failed(document_id)
            raise
        raise task.retry(exc=exc, countdown=RETRY_BACKOFF_SECONDS * (task.request.retries + 1))
    else:
        finish_event(event_id, "succeeded")
        return result


def _guess_mime_type(storage_path: str) -> str:
    lower = storage_path.lower()
    if lower.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith(".pdf"):
        return "application/pdf"
    if lower.endswith(".heic"):
        return "image/heic"
    if lower.endswith(".heif"):
        return "image/heif"
    return "application/octet-stream"


@app.task(bind=True, name="estimator_workers.tasks.fetch", max_retries=MAX_RETRIES)
def fetch(self: Task, document_id: str, company_id: str, storage_path: str) -> str:
    def _fetch() -> str:
        supabase = get_supabase()
        file_bytes = supabase.storage.from_("documents").download(storage_path)
        return base64.b64encode(file_bytes).decode()

    return _run_stage(self, document_id, "fetch", _fetch)


@app.task(bind=True, name="estimator_workers.tasks.extract", max_retries=MAX_RETRIES)
def extract(
    self: Task, file_b64: str, document_id: str, company_id: str, storage_path: str
) -> str:
    def _extract() -> str:
        mime_type = _guess_mime_type(storage_path)
        if mime_type not in SUPPORTED_MIME_TYPES:
            raise ValueError(f"Extraction does not support this file type. Got: {mime_type}")
        file_bytes = base64.b64decode(file_b64)
        return call_vision_llm(file_bytes, mime_type)

    return _run_stage(self, document_id, "extract", _extract)


@app.task(bind=True, name="estimator_workers.tasks.parse", max_retries=MAX_RETRIES)
def parse(
    self: Task, raw_text: str, document_id: str, company_id: str, storage_path: str
) -> None:
    def _parse() -> None:
        payload = parse_extraction_json(raw_text)
        supabase = get_supabase()
        supabase.table("extraction_results").insert(
            {"document_id": document_id, "payload": payload.model_dump()}
        ).execute()

    return _run_stage(self, document_id, "parse", _parse)


@app.task(name="estimator_workers.tasks.process_document")
def process_document(document_id: str, company_id: str, storage_path: str) -> None:
    try:
        chain(
            fetch.s(document_id, company_id, storage_path),
            extract.s(document_id, company_id, storage_path),
            parse.s(document_id, company_id, storage_path),
        ).apply_async()
    except Exception as exc:
        # If enqueueing the chain itself fails (e.g. the broker is briefly
        # unreachable at this exact moment), none of fetch/extract/parse
        # ever run, so _run_stage's event logging and failure handling
        # never fire either -- without this, the document would be stuck
        # at "pending" forever with zero DocumentProcessingEvent rows and
        # no way for the user to know anything went wrong. This task has
        # no retry/bind config (unlike fetch/extract/parse), so this is a
        # one-shot terminal failure, not a retryable one.
        event_id = start_event(document_id, "enqueue", 1)
        finish_event(event_id, "failed", str(exc))
        mark_document_failed(document_id)
        raise


# Runs after user confirmation, not during extraction -- keeps "confirm what
# was actually purchased" separate from "system does its catalog grouping".
# See docs/architecture.md -> MaterialMatch. No DocumentProcessingEvent
# equivalent here (that table is specifically the fetch/extract/parse
# pipeline); retry is simpler and unlogged.
@app.task(bind=True, name="estimator_workers.tasks.match_materials", max_retries=MAX_RETRIES)
def match_materials(self: Task, invoice_id: str, company_id: str) -> None:
    try:
        supabase = get_supabase()

        line_items = (
            supabase.table("line_items")
            .select("id, description")
            .eq("invoice_id", invoice_id)
            .execute()
            .data
        )
        if not line_items:
            return

        catalog = (
            supabase.table("material_catalog")
            .select("id, name")
            .eq("company_id", company_id)
            .execute()
            .data
        )
        catalog_ids = {m["id"] for m in catalog}
        # Tracks names already resolved to an id in this run (both
        # pre-existing catalog entries and ones just created below),
        # case-insensitive to match the DB's unique index. Without this,
        # two line items on the same invoice that both canonicalize to the
        # same not-yet-catalogued name (e.g. two "PT 2x8" rows) would each
        # insert their own MaterialCatalog row.
        ids_by_lower_name = {m["name"].lower(): m["id"] for m in catalog}

        result = match_line_items_to_catalog(line_items, catalog)

        rows = []
        for match in result.matches:
            if match.matched_material_id and match.matched_material_id in catalog_ids:
                material_id = match.matched_material_id
            else:
                name = match.new_material_name or "Unknown material"
                existing_id = ids_by_lower_name.get(name.lower())
                if existing_id:
                    material_id = existing_id
                else:
                    try:
                        new_material = (
                            supabase.table("material_catalog")
                            .insert({"company_id": company_id, "name": name})
                            .execute()
                            .data[0]
                        )
                        material_id = new_material["id"]
                    except APIError as exc:
                        # Backstop for a race this run's own in-loop dedup
                        # can't see: a concurrent match_materials run (or a
                        # retry after this run's own earlier partial
                        # failure) already created this name. Re-fetch
                        # instead of failing the whole task.
                        if exc.code != POSTGRES_UNIQUE_VIOLATION:
                            raise
                        existing = (
                            supabase.table("material_catalog")
                            .select("id")
                            .eq("company_id", company_id)
                            .ilike("name", name)
                            .limit(1)
                            .single()
                            .execute()
                            .data
                        )
                        material_id = existing["id"]
                    catalog_ids.add(material_id)
                    ids_by_lower_name[name.lower()] = material_id

            rows.append(
                {"line_item_id": match.line_item_id, "material_id": material_id, "status": "proposed"}
            )

        if rows:
            supabase.table("material_matches").insert(rows).execute()
    except Exception as exc:
        if self.request.retries >= self.max_retries:
            # No Document/status equivalent to flip -- matching failure just
            # means no MaterialMatch rows exist yet. The confirmed
            # Invoice/LineItem records are unaffected either way.
            raise
        raise self.retry(exc=exc, countdown=RETRY_BACKOFF_SECONDS * (self.request.retries + 1))
