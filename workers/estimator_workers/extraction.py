import base64
import json
import re

from anthropic import Anthropic
from pydantic import BaseModel

from estimator_workers.config import ANTHROPIC_API_KEY

SUPPORTED_MIME_TYPES = {"image/jpeg", "image/png"}


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


# Ported from web/src/lib/extraction.ts (Phase 2). The "own table cell"
# constraint was added after Phase 2 testing surfaced a real issue: a line
# item absorbed an unrelated "THURSDAY DELIVERY" note from elsewhere on the
# document. See docs/implementation_plan.md -> Phase 2 notes.
EXTRACTION_PROMPT = """You are extracting structured data from a photo or scan of a construction supplier invoice or receipt.

Return ONLY a JSON object (no markdown fences, no commentary) matching exactly this shape:

{
  "supplier_name": string,
  "invoice_date": string | null,  // ISO 8601 date (YYYY-MM-DD), null if not legible
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

Each line item's description must come only from that item's own row/cell in the table. Do not append delivery notes, stamps, handwriting, or any other text from elsewhere on the document into a line item's description.

If a multi-line description wraps across rows in the source table, join it into one description string. If a field is illegible, use null (or omit the line item entirely if it's unreadable). Do not invent data that is not visibly printed on the document."""

_client = Anthropic(api_key=ANTHROPIC_API_KEY)


def call_vision_llm(file_bytes: bytes, mime_type: str) -> str:
    b64 = base64.b64encode(file_bytes).decode()

    message = _client.messages.create(
        model="claude-sonnet-5",
        max_tokens=4096,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": mime_type, "data": b64},
                    },
                    {"type": "text", "text": EXTRACTION_PROMPT},
                ],
            }
        ],
    )

    text_block = next((b for b in message.content if b.type == "text"), None)
    if text_block is None:
        raise ValueError("Vision LLM returned no text content.")
    return text_block.text


def parse_extraction_json(raw_text: str) -> ExtractionPayload:
    # The prompt asks for raw JSON, but models sometimes wrap it in a
    # markdown code fence anyway -- strip that defensively rather than
    # relying on prompt compliance alone.
    json_text = re.sub(r"^```(?:json)?\n?", "", raw_text.strip())
    json_text = re.sub(r"\n?```$", "", json_text)

    try:
        data = json.loads(json_text)
    except json.JSONDecodeError:
        raise ValueError(f"Vision LLM did not return valid JSON: {raw_text[:500]}")

    payload = ExtractionPayload.model_validate(data)

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

    return payload
