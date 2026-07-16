import base64
import hashlib
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Callable, TypeVar

from celery import Task, chain
from celery.utils.log import get_task_logger
from postgrest.exceptions import APIError

from estimator_workers.celery_app import app
from estimator_workers.change_order_pdf import ChangeOrderData, render_change_order_pdf
from estimator_workers.config import APP_BASE_URL
from estimator_workers.emails import send_email
from estimator_workers.events import finish_event, mark_document_failed, start_event
from estimator_workers.extraction import (
    SUPPORTED_MIME_TYPES,
    NonRetryableExtractionError,
    call_vision_llm,
    parse_extraction_json,
)
from estimator_workers.matching import match_line_items_to_catalog
from estimator_workers.supabase_client import get_supabase

logger = get_task_logger(__name__)

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
    except NonRetryableExtractionError as exc:
        # Deterministic given the LLM's already-produced output (e.g. a
        # non-invoice upload with no supplier_name). Retrying re-parses the
        # identical text and fails identically, so fail terminally on the
        # first attempt instead of burning MAX_RETRIES backoffs.
        finish_event(event_id, "failed", str(exc))
        mark_document_failed(document_id)
        raise
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
        outcome = parse_extraction_json(raw_text)
        supabase = get_supabase()
        if outcome.rejected:
            # Not a purchase document. This is a successful classification,
            # not a pipeline failure -- record it as a distinct terminal
            # state carrying the model's reason, and write no
            # ExtractionResult (there is nothing to promote or confirm). The
            # review page renders 'rejected' calmly rather than as an error.
            # Note: this is the one place a stage's own work writes
            # documents.status on success; _run_stage still only writes
            # status on terminal *failure*.
            supabase.table("documents").update(
                {"status": "rejected", "rejection_reason": outcome.rejection_reason}
            ).eq("id", document_id).execute()

            # A rejected file isn't part of the purchasing record, so the
            # "originals are always retained" principle doesn't cover it --
            # and it may be a sensitive misfire (a resume, a photo of an ID).
            # Delete the stored object, keeping the row above as a tombstone
            # that still shows the outcome and reason in the UI. Best-effort:
            # the rejection is already durably recorded, so a failed cleanup
            # must not fail (and retry) the stage -- it just leaves an orphan
            # object a later sweep can reclaim. Ordered after the row update
            # so we never delete bytes for a rejection we didn't persist.
            try:
                supabase.storage.from_("documents").remove([storage_path])
            except Exception:
                logger.warning(
                    "Failed to delete storage object for rejected document %s (%s); "
                    "row is recorded, object orphaned.",
                    document_id,
                    storage_path,
                )
            return
        supabase.table("extraction_results").insert(
            {"document_id": document_id, "payload": outcome.payload.model_dump()}
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


# Renders the legal PDF artifact for an EXECUTED estimate version and
# records its storage path. Published best-effort by the client signing
# action (web/src/app/actions/client-signing.ts) after execution, and
# re-publishable from the version page's "Generate PDF" button -- the PDF
# is deterministically derived from the version's immutable rows, so
# re-running (or a retry racing a duplicate publish) just overwrites the
# object with identical content (upsert). Like match_materials, no
# DocumentProcessingEvent equivalent: failure means pdf_storage_path stays
# null and the UI keeps offering the manual retry.
# See docs/v2/plans/01-change-orders-plan.md -> Phase 4.
@app.task(bind=True, name="estimator_workers.tasks.render_change_order_pdf", max_retries=MAX_RETRIES)
def render_change_order_pdf_task(self: Task, version_id: str, company_id: str) -> None:
    try:
        supabase = get_supabase()

        version = (
            supabase.table("estimate_versions")
            .select("id, estimate_id, company_id, version_number, status, total, "
                    "pct_change_from_root, created_at")
            .eq("id", version_id)
            .eq("company_id", company_id)  # payload scoping, same as other tasks
            .single()
            .execute()
            .data
        )
        if version["status"] != "executed":
            # Only an executed version is a legal artifact. A stale/errant
            # publish for a non-executed version is a no-op, not an error.
            logger.info("Version %s is %s, not executed; skipping PDF.", version_id, version["status"])
            return

        lines = (
            supabase.table("estimate_version_lines")
            .select(
                "description, quantity, unit_price, markup_percent, total, change_kind, "
                "price_verified_at, created_at"
            )
            .eq("estimate_version_id", version_id)
            .order("created_at")
            .execute()
            .data
        )
        signatures = (
            supabase.table("estimate_signatures")
            .select("signer_role, signer_name, signature_data, signed_at")
            .eq("estimate_version_id", version_id)
            .order("signed_at")
            .execute()
            .data
        )
        estimate = (
            supabase.table("estimates")
            .select("name, companies(name)")
            .eq("id", version["estimate_id"])
            .single()
            .execute()
            .data
        )

        root_total = None
        if version["version_number"] != 1:
            root = (
                supabase.table("estimate_versions")
                .select("total")
                .eq("estimate_id", version["estimate_id"])
                .eq("version_number", 1)
                .single()
                .execute()
                .data
            )
            root_total = root["total"]

        pdf_bytes = render_change_order_pdf(
            ChangeOrderData(
                company_name=(estimate.get("companies") or {}).get("name", ""),
                estimate_name=estimate["name"],
                version_number=version["version_number"],
                created_at=version["created_at"],
                total=version["total"],
                root_total=root_total,
                pct_change_from_root=version["pct_change_from_root"],
                lines=lines,
                signatures=signatures,
            )
        )

        # Same bucket + {company_id}/ prefix as original documents, so the
        # company-scoped storage policy (0005) covers it unchanged.
        storage_path = f"{company_id}/change-orders/{version_id}.pdf"
        supabase.storage.from_("documents").upload(
            storage_path,
            pdf_bytes,
            file_options={"content-type": "application/pdf", "upsert": "true"},
        )

        supabase.table("estimate_versions").update({"pdf_storage_path": storage_path}).eq(
            "id", version_id
        ).execute()
    except Exception as exc:
        if self.request.retries >= self.max_retries:
            raise
        raise self.retry(exc=exc, countdown=RETRY_BACKOFF_SECONDS * (self.request.retries + 1))


# ---------------------------------------------------------------------------
# Change-order notifications (docs/v2/plans/01-change-orders-plan.md ->
# Phase 5). Email transport lives in emails.py (Resend when configured,
# console transport otherwise).


def _estimate_context(supabase, version_id: str) -> dict:
    """Names + numbers most notification bodies need."""
    version = (
        supabase.table("estimate_versions")
        .select("id, estimate_id, version_number, status, total")
        .eq("id", version_id)
        .single()
        .execute()
        .data
    )
    estimate = (
        supabase.table("estimates")
        .select("name, companies(name)")
        .eq("id", version["estimate_id"])
        .single()
        .execute()
        .data
    )
    return {
        "version": version,
        "estimate_name": estimate["name"],
        "company_name": (estimate.get("companies") or {}).get("name", "Your contractor"),
    }


def _company_member_emails(supabase, company_id: str) -> list[str]:
    members = (
        supabase.table("company_members")
        .select("user_id")
        .eq("company_id", company_id)
        .execute()
        .data
    )
    emails = []
    for member in members:
        try:
            user = supabase.auth.admin.get_user_by_id(member["user_id"]).user
            if user and user.email:
                emails.append(user.email)
        except Exception:
            logger.warning("Couldn't resolve email for user %s", member["user_id"])
    return emails


@app.task(bind=True, name="estimator_workers.tasks.send_signing_request_email", max_retries=MAX_RETRIES)
def send_signing_request_email(
    self: Task, version_id: str, company_id: str, client_email: str, signing_url: str
) -> None:
    """Emails the client their signing link. The raw signing URL travels
    as a task argument because it exists nowhere else -- the database
    stores only the token's hash."""
    try:
        supabase = get_supabase()
        ctx = _estimate_context(supabase, version_id)
        version = ctx["version"]
        kind = "estimate" if version["version_number"] == 1 else "change order"
        send_email(
            to=client_email,
            subject=f"{ctx['company_name']} sent you a {kind} to sign",
            text=(
                f"{ctx['company_name']} has sent you a {kind} for "
                f'"{ctx["estimate_name"]}" (version {version["version_number"]}, '
                f"total ${version['total']:,.2f}) to review and sign.\n\n"
                f"Review and sign here:\n{signing_url}\n\n"
                f"This link is unique to you and can be used once. If it expires, "
                f"ask {ctx['company_name']} to send a new one."
            ),
        )
    except Exception as exc:
        if self.request.retries >= self.max_retries:
            raise
        raise self.retry(exc=exc, countdown=RETRY_BACKOFF_SECONDS * (self.request.retries + 1))


@app.task(bind=True, name="estimator_workers.tasks.notify_change_order_executed", max_retries=MAX_RETRIES)
def notify_change_order_executed(self: Task, version_id: str, company_id: str) -> None:
    """Tells the contractor (every company member) that the client signed."""
    try:
        supabase = get_supabase()
        ctx = _estimate_context(supabase, version_id)
        version = ctx["version"]
        client = (
            supabase.table("estimate_signatures")
            .select("signer_name")
            .eq("estimate_version_id", version_id)
            .eq("signer_role", "client")
            .maybe_single()
            .execute()
        )
        client_name = client.data["signer_name"] if client and client.data else "The client"
        for email in _company_member_emails(supabase, company_id):
            send_email(
                to=email,
                subject=f"Signed: {ctx['estimate_name']} (version {version['version_number']})",
                text=(
                    f"{client_name} has signed \"{ctx['estimate_name']}\" version "
                    f"{version['version_number']} (total ${version['total']:,.2f}).\n\n"
                    f"The change order is now executed. The signed PDF is available "
                    f"on the version page:\n"
                    f"{APP_BASE_URL}/estimates/{version['estimate_id']}/versions/{version_id}"
                ),
            )
    except Exception as exc:
        if self.request.retries >= self.max_retries:
            raise
        raise self.retry(exc=exc, countdown=RETRY_BACKOFF_SECONDS * (self.request.retries + 1))


REMINDER_AFTER_DAYS = 3
SIGNING_TOKEN_TTL_DAYS = 30  # keep in sync with web/src/lib/signatures.ts


def _generate_token_pair() -> tuple[str, str]:
    """(raw_token, token_hash) matching web/src/lib/signatures.ts exactly:
    32 random bytes -> base64url (no padding); SHA-256 hex of that string."""
    raw = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")
    return raw, hashlib.sha256(raw.encode()).hexdigest()


@app.task(name="estimator_workers.tasks.send_signing_reminders")
def send_signing_reminders() -> int:
    """Beat-scheduled sweep: clients who were emailed a signing link
    REMINDER_AFTER_DAYS ago and haven't signed get one reminder.

    Raw tokens are never stored, so the original link can't be resent --
    the sweep mints a fresh token (same client_email), revokes the old
    one, and emails the new link. The fresh row carries reminder_sent_at,
    which excludes it from future sweeps: one reminder per signing chain.
    Returns the number of reminders sent (visible in worker logs)."""
    supabase = get_supabase()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=REMINDER_AFTER_DAYS)).isoformat()

    stale = (
        supabase.table("client_signing_tokens")
        .select("id, estimate_version_id, company_id, client_email, created_at")
        .is_("used_at", "null")
        .is_("reminder_sent_at", "null")
        .not_.is_("client_email", "null")
        .lt("created_at", cutoff)
        .execute()
        .data
    )

    sent = 0
    for token in stale:
        version = (
            supabase.table("estimate_versions")
            .select("id, status")
            .eq("id", token["estimate_version_id"])
            .single()
            .execute()
            .data
        )
        if version["status"] != "pending_client_signature":
            # Superseded or executed since -- nothing to remind; drop the
            # dead token like the supersede path does.
            supabase.table("client_signing_tokens").delete().eq("id", token["id"]).execute()
            continue

        raw, token_hash = _generate_token_pair()
        now = datetime.now(timezone.utc)
        supabase.table("client_signing_tokens").insert(
            {
                "estimate_version_id": token["estimate_version_id"],
                "company_id": token["company_id"],
                "token_hash": token_hash,
                "client_email": token["client_email"],
                "expires_at": (now + timedelta(days=SIGNING_TOKEN_TTL_DAYS)).isoformat(),
                "reminder_sent_at": now.isoformat(),
            }
        ).execute()
        supabase.table("client_signing_tokens").delete().eq("id", token["id"]).execute()

        ctx = _estimate_context(supabase, token["estimate_version_id"])
        kind = "estimate" if ctx["version"]["version_number"] == 1 else "change order"
        send_email(
            to=token["client_email"],
            subject=f"Reminder: a {kind} from {ctx['company_name']} is waiting for your signature",
            text=(
                f"{ctx['company_name']} is still waiting for your signature on "
                f"\"{ctx['estimate_name']}\" (version {ctx['version']['version_number']}, "
                f"total ${ctx['version']['total']:,.2f}).\n\n"
                f"Review and sign here (this replaces the earlier link):\n"
                f"{APP_BASE_URL}/sign/{raw}\n"
            ),
        )
        sent += 1

    logger.info("send_signing_reminders: %d reminder(s) sent", sent)
    return sent


# ---------------------------------------------------------------------------
# Contractor credential verification (docs/v2/plans/02-verification-plan.md).


@app.task(bind=True, name="estimator_workers.tasks.extract_credential", max_retries=MAX_RETRIES)
def extract_credential(self: Task, credential_id: str, company_id: str, storage_path: str) -> None:
    """Reads key fields (expiry especially) off an uploaded certificate.
    Best-effort: extraction failure leaves the typed columns null for the
    contractor to fill in by hand -- never fabricated. Only fills columns
    that are still null, so a contractor's manual correction is never
    overwritten by a re-run."""
    from estimator_workers.credential_extraction import (
        build_credential_prompt,
        parse_credential_json,
    )

    try:
        supabase = get_supabase()
        credential = (
            supabase.table("credentials")
            .select("id, credential_type, issued_date, expiry_date, coverage_amount, provider")
            .eq("id", credential_id)
            .eq("company_id", company_id)
            .single()
            .execute()
            .data
        )

        file_bytes = supabase.storage.from_("documents").download(storage_path)
        raw_text = call_vision_llm(
            file_bytes,
            _guess_mime_type(storage_path),
            prompt=build_credential_prompt(credential["credential_type"]),
        )
        parsed = parse_credential_json(raw_text)

        update = {"extraction_result": parsed["raw"], "last_checked_at": "now()"}
        for field in ("issued_date", "expiry_date", "coverage_amount", "provider"):
            if credential.get(field) is None and parsed[field] is not None:
                update[field] = parsed[field]
        supabase.table("credentials").update(update).eq("id", credential_id).execute()
    except Exception as exc:
        if self.request.retries >= self.max_retries:
            # Terminal: mark the attempt so the UI stops showing "reading
            # certificate" forever; fields stay null for manual entry.
            try:
                get_supabase().table("credentials").update({"last_checked_at": "now()"}).eq(
                    "id", credential_id
                ).execute()
            except Exception:
                pass
            raise
        raise self.retry(exc=exc, countdown=RETRY_BACKOFF_SECONDS * (self.request.retries + 1))


# 30/14/1-day reminder windows; stage number = how many reminders a
# credential should have received once inside that window.
EXPIRY_REMINDER_STAGES = [(30, 1), (14, 2), (1, 3)]


@app.task(name="estimator_workers.tasks.credential_expiry_sweep")
def credential_expiry_sweep() -> dict:
    """Beat-scheduled: flips past-expiry credentials to 'expired' and
    sends staged 30/14/1-day reminders to company members. Each stage
    fires exactly once per credential (expiry_reminders_sent records the
    highest stage already sent)."""
    supabase = get_supabase()
    today = datetime.now(timezone.utc).date()

    active = (
        supabase.table("credentials")
        .select("id, company_id, credential_type, expiry_date, status, expiry_reminders_sent")
        .is_("superseded_at", "null")
        .not_.is_("expiry_date", "null")
        .execute()
        .data
    )

    type_labels = {
        "wsib": "WSIB clearance certificate",
        "liability_insurance": "liability insurance certificate",
        "business_registration": "business registration",
    }
    expired = 0
    reminded = 0
    for cred in active:
        expiry = date.fromisoformat(cred["expiry_date"])
        days_left = (expiry - today).days

        if days_left < 0:
            if cred["status"] != "expired":
                supabase.table("credentials").update({"status": "expired"}).eq(
                    "id", cred["id"]
                ).execute()
                expired += 1
                for email in _company_member_emails(supabase, cred["company_id"]):
                    send_email(
                        to=email,
                        subject=f"Expired: your {type_labels[cred['credential_type']]}",
                        text=(
                            f"Your {type_labels[cred['credential_type']]} expired on "
                            f"{cred['expiry_date']}. Upload a renewed certificate:\n"
                            f"{APP_BASE_URL}/credentials"
                        ),
                    )
            continue

        stage = 0
        for threshold_days, stage_number in EXPIRY_REMINDER_STAGES:
            if days_left <= threshold_days:
                stage = stage_number
        if stage > cred["expiry_reminders_sent"]:
            for email in _company_member_emails(supabase, cred["company_id"]):
                send_email(
                    to=email,
                    subject=(
                        f"Renewal reminder: {type_labels[cred['credential_type']]} "
                        f"expires in {days_left} day{'s' if days_left != 1 else ''}"
                    ),
                    text=(
                        f"Your {type_labels[cred['credential_type']]} expires on "
                        f"{cred['expiry_date']} ({days_left} day{'s' if days_left != 1 else ''} "
                        f"from now). Upload a renewed certificate before it lapses:\n"
                        f"{APP_BASE_URL}/credentials"
                    ),
                )
            supabase.table("credentials").update({"expiry_reminders_sent": stage}).eq(
                "id", cred["id"]
            ).execute()
            reminded += 1

    logger.info("credential_expiry_sweep: %d expired, %d reminded", expired, reminded)
    return {"expired": expired, "reminded": reminded}


# ---------------------------------------------------------------------------
# Vendor price verification (docs/v2/plans/05-vendor-price-check-plan.md).


@app.task(name="estimator_workers.tasks.check_vendor_price")
def check_vendor_price(estimate_line_id: str, company_id: str) -> str:
    """Fetches the line's saved vendor product URL and records what the
    page currently says. NEVER changes the line's price -- 'changed' is a
    flag for the contractor to act on. No Celery retries: a blocked or
    broken vendor page fails the same way every time, so one attempt is
    recorded as 'unverifiable' and the contractor can re-check on demand.
    Returns the outcome (visible in worker logs)."""
    from estimator_workers.vendor_price import (
        PriceCheckFailure,
        extract_price,
        fetch_page,
        prices_match,
    )

    supabase = get_supabase()
    line = (
        supabase.table("estimate_lines")
        .select("id, unit_price, vendor_product_url")
        .eq("id", estimate_line_id)
        .eq("company_id", company_id)
        .single()
        .execute()
        .data
    )
    url = line.get("vendor_product_url")
    if not url:
        logger.info("Line %s has no vendor URL; nothing to check.", estimate_line_id)
        return "skipped"

    estimate_price = float(line["unit_price"])
    fetched_price: float | None = None
    try:
        fetched_price = extract_price(fetch_page(url))
        outcome = "confirmed" if prices_match(estimate_price, fetched_price) else "changed"
    except PriceCheckFailure as exc:
        logger.info("Price check unverifiable for line %s: %s", estimate_line_id, exc)
        outcome = "unverifiable"

    now = datetime.now(timezone.utc).isoformat()
    supabase.table("vendor_price_checks").insert(
        {
            "estimate_line_id": estimate_line_id,
            "company_id": company_id,
            "vendor_product_url": url,
            "estimate_price": estimate_price,
            "fetched_price": fetched_price,
            "outcome": outcome,
            "checked_at": now,
        }
    ).execute()

    # Only a CONFIRMED check stamps the line -- "verified" means the
    # vendor page agreed with the price the estimate is using.
    if outcome == "confirmed":
        supabase.table("estimate_lines").update({"price_verified_at": now}).eq(
            "id", estimate_line_id
        ).execute()

    return outcome
