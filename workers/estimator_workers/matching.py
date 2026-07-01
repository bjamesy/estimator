import json
import re

from anthropic import Anthropic
from pydantic import BaseModel

from estimator_workers.config import ANTHROPIC_API_KEY

_client = Anthropic(api_key=ANTHROPIC_API_KEY)


class LineItemMatch(BaseModel):
    line_item_id: str
    matched_material_id: str | None
    new_material_name: str | None


class MatchResult(BaseModel):
    matches: list[LineItemMatch]


MATCHING_PROMPT_TEMPLATE = """You are matching construction material purchase line items to a company's canonical material catalog. Line items come from different suppliers who describe the same material differently -- abbreviations, unit ordering, brand-specific codes. Your job is to recognize when a line item refers to a material that's already in the catalog, even if the wording differs.

Example: a line item "P.T. 2 X 8 X 12' K.D. #2 & BTR NET" and an existing catalog entry "PT 2x8" likely refer to the same underlying material (pressure-treated 2x8 lumber), even though the supplier's phrasing is far more verbose.

Existing catalog materials for this company:
{catalog}

Line items to match:
{line_items}

For each line item, decide:
- If it matches an existing catalog material, set "matched_material_id" to that material's id and "new_material_name" to null.
- If it does NOT match anything in the catalog, set "matched_material_id" to null and "new_material_name" to a concise canonical name for it (e.g. "PT 2x8", not the full supplier description).

Return ONLY a JSON object (no markdown fences, no commentary) matching exactly this shape:

{{
  "matches": [
    {{
      "line_item_id": string,
      "matched_material_id": string | null,
      "new_material_name": string | null
    }}
  ]
}}

Include exactly one entry per line item listed above, using its exact line_item_id."""


def _format_catalog(catalog: list[dict]) -> str:
    if not catalog:
        return "(empty -- no materials catalogued yet for this company)"
    return "\n".join(f"- id={m['id']}: {m['name']}" for m in catalog)


def _format_line_items(line_items: list[dict]) -> str:
    return "\n".join(f"- id={li['id']}: {li['description']}" for li in line_items)


def match_line_items_to_catalog(line_items: list[dict], catalog: list[dict]) -> MatchResult:
    prompt = MATCHING_PROMPT_TEMPLATE.format(
        catalog=_format_catalog(catalog),
        line_items=_format_line_items(line_items),
    )

    message = _client.messages.create(
        model="claude-sonnet-5",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    text_block = next((b for b in message.content if b.type == "text"), None)
    if text_block is None:
        raise ValueError("Matching LLM returned no text content.")

    # Same defensive fence-stripping as extraction.py -- models sometimes
    # wrap JSON in a markdown code fence despite being told not to.
    json_text = re.sub(r"^```(?:json)?\n?", "", text_block.text.strip())
    json_text = re.sub(r"\n?```$", "", json_text)

    try:
        data = json.loads(json_text)
    except json.JSONDecodeError:
        raise ValueError(f"Matching LLM did not return valid JSON: {text_block.text[:500]}")

    return MatchResult.model_validate(data)
