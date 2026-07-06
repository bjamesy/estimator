import base64
import io
import json
import re

import pillow_heif
from anthropic import Anthropic
from PIL import Image
from pydantic import BaseModel, ValidationError

from estimator_workers.config import ANTHROPIC_API_KEY

# Registers HEIC/HEIF in Pillow's format dispatch tables so Image.open()
# can decode them. Registration alone touches no bytes -- Image.open()
# still sniffs each file's magic bytes to pick a decoder, so JPEG/PNG
# files are unaffected by this being registered.
pillow_heif.register_heif_opener()

# Types this pipeline can extract from -- not the same thing as what
# Claude's API accepts raw. HEIC/HEIF are converted to JPEG in memory
# first (Claude's vision API only takes JPEG/PNG/GIF/WEBP), and PDF goes
# through the API's native "document" block rather than an "image" block.
SUPPORTED_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/heic",
    "image/heif",
    "application/pdf",
}

_HEIC_MIME_TYPES = {"image/heic", "image/heif"}


class LineItem(BaseModel):
    description: str
    sku: str | None
    # Nullable to match what EXTRACTION_PROMPT actually tells the model
    # ("if a field is illegible, use null"). A non-nullable float here
    # caused a real bug: one illegible number on an otherwise-legible
    # receipt would fail pydantic validation and permanently terminal-fail
    # the whole document after 3 wasted retries (retrying re-parses the
    # same LLM output, so it fails identically every time). See
    # parse_extraction_json, which drops incomplete line items rather than
    # letting them crash the whole payload.
    quantity: float | None
    unit_price: float | None
    total: float | None


class ExtractionPayload(BaseModel):
    supplier_name: str
    invoice_date: str | None
    total: float | None
    line_items: list[LineItem]


# Document types this pipeline can promote into the historical record.
# Anything else the model sees (a quote, a resume, a blank page) comes back
# as "other" and is rejected -- see parse_extraction_json.
ACCEPTED_DOCUMENT_TYPES = {"invoice", "receipt"}

# Ported from web/src/lib/extraction.ts (Phase 2). The "own table cell"
# constraint was added after Phase 2 testing surfaced a real issue: a line
# item absorbed an unrelated "THURSDAY DELIVERY" note from elsewhere on the
# document. See docs/mvp/implementation_plan.md -> Phase 2 notes.
#
# The classification head (document_type/rejection_reason) is folded into
# this same call rather than run as a separate pre-flight: the image is
# already loaded here, so classifying costs a handful of tokens instead of a
# second full vision request. See docs/architecture.md -> Extraction
# Pipeline.
EXTRACTION_PROMPT = """You are processing a photo or scan uploaded to a construction purchasing knowledge base.

First decide whether this document records an ACTUAL COMPLETED PURCHASE -- a supplier invoice or receipt for materials the business already bought and paid for, with priced line items.

The following are NOT accepted, because they are not a record of money actually spent:
- Quotes, estimates, bids, or price lists (proposed prices, not a purchase)
- Purchase orders or order confirmations (an order placed, not yet a paid transaction)
- Account statements (a summary of other invoices, not itself a purchase)
- Delivery slips or packing lists with no prices
- Anything that is not a purchasing document at all (a resume, an ID, a letter, a random photo, a blank page)

Return ONLY a JSON object (no markdown fences, no commentary) matching exactly this shape:

{
  "document_type": "invoice" | "receipt" | "other",  // "other" for anything in the NOT-accepted list above
  "rejection_reason": string | null,  // when "other", one short sentence naming what it appears to be; otherwise null
  "supplier_name": string | null,     // the supplier's name when accepted; null when "other"
  "invoice_date": string | null,      // ISO 8601 date (YYYY-MM-DD), null if not legible
  "total": number | null,
  "line_items": [
    {
      "description": string,     // exactly as printed on the invoice, do not normalize or interpret abbreviations
      "sku": string | null,
      "quantity": number,
      "unit_price": number,
      "total": number
    }
  ]
}

When document_type is "other", set rejection_reason and you may leave supplier_name null and line_items empty.

For an accepted invoice or receipt: each line item's description must come only from that item's own row/cell in the table. Do not append delivery notes, stamps, handwriting, or any other text from elsewhere on the document into a line item's description.

If a multi-line description wraps across rows in the source table, join it into one description string. If a field is illegible, use null (or omit the line item entirely if it's unreadable). Do not invent data that is not visibly printed on the document."""

_client = Anthropic(api_key=ANTHROPIC_API_KEY)


def _convert_heic_to_jpeg(file_bytes: bytes) -> bytes:
    """Transient, in-memory conversion for the Claude API call only.

    The converted JPEG is never written back to Supabase Storage and never
    replaces the stored original -- the uploaded HEIC file stays exactly as
    the user sent it, per "documents are source of truth... originals are
    always retained" (CLAUDE.md). Conversion is needed because Claude's
    vision API only accepts JPEG/PNG/GIF/WEBP.
    """
    image = Image.open(io.BytesIO(file_bytes))
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="JPEG")
    return buffer.getvalue()


# `prompt` defaults to invoice extraction; credential extraction
# (credential_extraction.py) passes its own prompt and reuses the
# HEIC conversion + PDF document-block handling here unchanged.
def call_vision_llm(file_bytes: bytes, mime_type: str, prompt: str = EXTRACTION_PROMPT) -> str:
    if mime_type in _HEIC_MIME_TYPES:
        file_bytes = _convert_heic_to_jpeg(file_bytes)
        mime_type = "image/jpeg"

    b64 = base64.b64encode(file_bytes).decode()

    if mime_type == "application/pdf":
        # Claude's Messages API accepts PDFs natively as a "document"
        # block -- it converts pages to images and extracts each page's
        # text internally, all within this one request, so multi-page
        # PDFs need no special handling here.
        content_block = {
            "type": "document",
            "source": {"type": "base64", "media_type": mime_type, "data": b64},
        }
    else:
        content_block = {
            "type": "image",
            "source": {"type": "base64", "media_type": mime_type, "data": b64},
        }

    message = _client.messages.create(
        model="claude-sonnet-5",
        max_tokens=4096,
        messages=[
            {
                "role": "user",
                "content": [content_block, {"type": "text", "text": prompt}],
            }
        ],
    )

    text_block = next((b for b in message.content if b.type == "text"), None)
    if text_block is None:
        raise ValueError("Vision LLM returned no text content.")
    return text_block.text


class NonRetryableExtractionError(Exception):
    """The LLM's output is deterministically unusable, so retrying is
    pointless -- the same text re-parses to the same failure every time.

    This is for *malformed* output (non-JSON prose, or an accepted
    invoice/receipt whose payload fails validation). It is NOT the path for
    a non-purchase document -- that comes back cleanly as document_type
    "other" and is a rejection (a successful classification), not a failure.
    _run_stage (workers/estimator_workers/tasks.py) treats this as a terminal
    failure on the first attempt instead of burning MAX_RETRIES backoffs to
    reach the same conclusion."""


class ParseOutcome(BaseModel):
    """The result of parsing the vision LLM's output. Exactly one state
    holds: `rejected` (a non-purchase document -- payload is None, carry the
    reason to the review page) or accepted (a validated ExtractionPayload
    ready to promote)."""

    rejected: bool
    rejection_reason: str | None = None
    payload: ExtractionPayload | None = None


def parse_extraction_json(raw_text: str) -> ParseOutcome:
    # The prompt asks for raw JSON, but models sometimes wrap it in a
    # markdown code fence anyway -- strip that defensively rather than
    # relying on prompt compliance alone.
    json_text = re.sub(r"^```(?:json)?\n?", "", raw_text.strip())
    json_text = re.sub(r"\n?```$", "", json_text)

    try:
        data = json.loads(json_text)
    except json.JSONDecodeError:
        raise NonRetryableExtractionError(
            f"Vision LLM did not return valid JSON: {raw_text[:500]}"
        )

    if not isinstance(data, dict):
        raise NonRetryableExtractionError(
            f"Vision LLM returned non-object JSON: {raw_text[:500]}"
        )

    # Classification gate. A document that isn't a completed purchase (a
    # quote, a resume, a blank page) is rejected here before any attempt to
    # validate invoice fields -- this is why a non-invoice never reaches the
    # supplier_name check below and never terminal-fails as "malformed". A
    # missing/unknown document_type is treated as "other" (fail safe: don't
    # promote something we couldn't confirm is a purchase).
    if data.get("document_type") not in ACCEPTED_DOCUMENT_TYPES:
        reason = data.get("rejection_reason")
        if not isinstance(reason, str) or not reason.strip():
            reason = "This does not appear to be an invoice or receipt."
        return ParseOutcome(rejected=True, rejection_reason=reason.strip())

    try:
        payload = ExtractionPayload.model_validate(data)
    except ValidationError as exc:
        # The model classified this as an invoice/receipt but the payload
        # doesn't hold together (e.g. supplier_name=null despite the type).
        # Deterministic, so don't retry. See NonRetryableExtractionError.
        raise NonRetryableExtractionError(
            f"Extracted data did not match the expected invoice shape: {exc}"
        )

    # A line item with any illegible numeric field isn't usable historical
    # data -- it's more honest to drop it than to fabricate a value (e.g.
    # zero) that would misrepresent what was actually purchased. This is
    # the server-side equivalent of the prompt's own fallback ("or omit
    # the line item entirely if it's unreadable"), applied uniformly
    # rather than left to the model's discretion.
    payload.line_items = [
        item
        for item in payload.line_items
        if item.quantity is not None and item.unit_price is not None and item.total is not None
    ]

    return ParseOutcome(rejected=False, payload=payload)
