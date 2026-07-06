"""Credential certificate field extraction.

Reuses the invoice pipeline's vision call (call_vision_llm handles HEIC
conversion and PDF document blocks) with a credential-specific prompt.
Same honesty principle as invoice line items: a field the model can't
read stays null -- the contractor fills it in by hand -- rather than
being fabricated. See docs/v2/plans/02-verification-plan.md -> Phase 2.
"""

import json
import re
from datetime import date

CREDENTIAL_TYPE_HINTS = {
    "wsib": "a WSIB (Workplace Safety and Insurance Board) clearance certificate",
    "liability_insurance": "a commercial general liability insurance certificate",
    "business_registration": "a business registration or corporate good-standing document",
}

CREDENTIAL_PROMPT_TEMPLATE = """You are reading a document uploaded to a construction business's credential file. It is expected to be {type_hint}, but read what is actually there.

Return ONLY a JSON object (no markdown fences, no commentary) with exactly these keys:

{{
  "matches_expected_type": true or false,
  "issued_date": "YYYY-MM-DD" or null,
  "expiry_date": "YYYY-MM-DD" or null,
  "provider": "issuing organization / insurer name" or null,
  "coverage_amount": number or null,
  "reference_number": "policy / clearance / registration number" or null,
  "notes": "one short line about anything ambiguous" or null
}}

Rules:
- If a value is not clearly legible on the document, use null. Never guess or fabricate.
- coverage_amount is the liability coverage limit in dollars (e.g. 2000000 for $2M). Only for insurance documents; null otherwise.
- expiry_date is the date the certificate/clearance/policy ceases to be valid.
"""


def build_credential_prompt(credential_type: str) -> str:
    hint = CREDENTIAL_TYPE_HINTS.get(credential_type, "a business credential document")
    return CREDENTIAL_PROMPT_TEMPLATE.format(type_hint=hint)


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _clean_date(value) -> str | None:
    if isinstance(value, str) and _DATE_RE.match(value):
        try:
            date.fromisoformat(value)
            return value
        except ValueError:
            return None
    return None


def parse_credential_json(raw_text: str) -> dict:
    """Parse + sanitize the model's output. Returns a dict with the raw
    payload under 'raw' and typed, validated fields ready for the
    credentials row (invalid/illegible values degrade to None)."""
    text = raw_text.strip()
    # Tolerate accidental markdown fences the same way invoice parsing does.
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S)
    payload = json.loads(text)

    coverage = payload.get("coverage_amount")
    if not isinstance(coverage, (int, float)):
        coverage = None

    provider = payload.get("provider")
    if not isinstance(provider, str) or not provider.strip():
        provider = None

    return {
        "raw": payload,
        "issued_date": _clean_date(payload.get("issued_date")),
        "expiry_date": _clean_date(payload.get("expiry_date")),
        "coverage_amount": coverage,
        "provider": provider,
    }
