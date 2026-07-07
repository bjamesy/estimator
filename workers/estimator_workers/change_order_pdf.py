"""Change-order PDF rendering.

The PDF is the legal artifact of an executed estimate version; the
structured rows it is rendered from (estimate_versions,
estimate_version_lines, estimate_signatures) remain the source of truth
and the file can be deterministically regenerated from them at any time.
See docs/v2/plans/01-change-orders-plan.md -> Phase 4.

All document language lives in TEMPLATE below, never inline in the
rendering code, so the placeholder copy can be swapped for the Ontario
construction lawyer's vetted template without touching layout logic
(docs/v2/plans/00-roadmap.md -> cross-cutting decision 1).
"""

from dataclasses import dataclass
from datetime import datetime

from fpdf import FPDF

# PLACEHOLDER legal copy -- awaiting the lawyer-vetted template. Slot
# names are the contract between template and renderer; the vetted
# template must fill the same slots.
TEMPLATE = {
    "title_root": "Estimate",
    "title_change_order": "Change Order",
    "cpa_notice": (
        "This change order increases the total cost by {pct}% over the original "
        "estimate. Ontario's Consumer Protection Act requires documented client "
        "consent for cost increases of 10% or more over an estimate; the client "
        "signature below records that consent."
    ),
    "consent_statement": (
        "I have reviewed this change order, including the revised total and each "
        "changed line item, and I consent to the price change it describes."
    ),
    "signature_attestation": (
        "Signed electronically via Estimator. The typed name below was adopted "
        "as a signature by the signer on the date shown."
    ),
    "footer_disclaimer": (
        "[PLACEHOLDER -- pending legal review] This document records the parties' "
        "agreement to the revised estimate above. It was generated from records "
        "kept by Estimator on behalf of the contractor."
    ),
}

# fpdf2's built-in fonts are latin-1 only; estimate text routinely holds
# em dashes and curly quotes (not in latin-1). Downgrade the common cases
# and replace anything else, rather than shipping a TTF for v1.
_UNICODE_FALLBACKS = str.maketrans(
    {
        "—": "-",  # em dash
        "–": "-",  # en dash
        "‘": "'",
        "’": "'",
        "“": '"',
        "”": '"',
        "•": "*",
        "×": "x",
    }
)


def _latin1(text: str) -> str:
    return text.translate(_UNICODE_FALLBACKS).encode("latin-1", "replace").decode("latin-1")


def _money(value: float) -> str:
    return f"${value:,.2f}"


CHANGE_LABELS = {
    "unchanged": "",
    "added": "Added",
    "modified": "Changed",
    "removed": "Removed",
}


@dataclass
class ChangeOrderData:
    company_name: str
    estimate_name: str
    version_number: int
    created_at: str
    total: float
    root_total: float | None  # None on the root version
    pct_change_from_root: float | None
    lines: list[dict]  # description, quantity, unit_price, markup_percent, total, change_kind
    signatures: list[dict]  # signer_role, signer_name, signature_data, signed_at


def render_change_order_pdf(data: ChangeOrderData) -> bytes:
    is_root = data.version_number == 1
    title = TEMPLATE["title_root"] if is_root else TEMPLATE["title_change_order"]

    pdf = FPDF(format="letter")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    # Header
    pdf.set_font("helvetica", size=9)
    pdf.set_text_color(110, 110, 110)
    pdf.cell(0, 5, _latin1(data.company_name), new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("helvetica", style="B", size=18)
    pdf.cell(0, 10, _latin1(f"{title} - {data.estimate_name}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("helvetica", size=10)
    pdf.set_text_color(110, 110, 110)
    pdf.cell(
        0,
        6,
        _latin1(f"Version {data.version_number} - snapshotted {data.created_at[:10]}"),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.set_text_color(0, 0, 0)
    pdf.ln(2)

    # CPA notice
    pct = data.pct_change_from_root
    if pct is not None and pct >= 10:
        pdf.set_fill_color(255, 243, 205)
        pdf.set_font("helvetica", size=10)
        pdf.multi_cell(
            0,
            5.5,
            _latin1(TEMPLATE["cpa_notice"].format(pct=f"{pct:.1f}")),
            fill=True,
            new_x="LMARGIN",
            new_y="NEXT",
        )
        # Reset: fill color is sticky state and would otherwise tint the
        # line-item table rows below (observed live).
        pdf.set_fill_color(255, 255, 255)
        pdf.ln(3)

    # Totals
    pdf.set_font("helvetica", size=10)
    totals_bits = []
    if data.root_total is not None:
        totals_bits.append(f"Original estimate (v1): {_money(data.root_total)}")
    totals_bits.append(f"This version: {_money(data.total)}")
    if pct is not None:
        totals_bits.append(f"{'+' if pct >= 0 else ''}{pct:.1f}% vs. original")
    pdf.cell(0, 6, _latin1("    ".join(totals_bits)), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    # Line items. Removed lines are part of the record (the change being
    # consented to) but are excluded from the version total.
    pdf.set_font("helvetica", size=9)
    with pdf.table(
        col_widths=(66, 14, 22, 18, 24, 20),
        text_align=("LEFT", "RIGHT", "RIGHT", "RIGHT", "RIGHT", "LEFT"),
        borders_layout="HORIZONTAL_LINES",
        line_height=6,
    ) as table:
        header = table.row()
        for label in ("Description", "Qty", "Unit price", "Markup %", "Total", "Change"):
            header.cell(label)
        for line in data.lines:
            removed = line["change_kind"] == "removed"
            row = table.row()
            if removed:
                pdf.set_text_color(150, 150, 150)
            # Vendor price-check audit stamp (docs/v2/plans/
            # 05-vendor-price-check-plan.md): a line whose price was
            # confirmed against the vendor's live product page carries
            # the verification date into the legal document.
            description = line["description"]
            if line.get("price_verified_at"):
                description += f" (price verified {line['price_verified_at'][:10]})"
            row.cell(_latin1(description))
            row.cell(f"{line['quantity']:g}")
            row.cell(_money(line["unit_price"]))
            row.cell(f"{line['markup_percent']:g}%")
            row.cell(_money(line["total"]))
            row.cell(CHANGE_LABELS.get(line["change_kind"], line["change_kind"]))
            if removed:
                pdf.set_text_color(0, 0, 0)

    pdf.set_font("helvetica", style="B", size=10)
    pdf.cell(0, 8, _latin1(f"Version total: {_money(data.total)}"), align="R", new_x="LMARGIN", new_y="NEXT")
    if any(l["change_kind"] == "removed" for l in data.lines):
        pdf.set_font("helvetica", size=8)
        pdf.set_text_color(110, 110, 110)
        pdf.cell(
            0, 5, "Removed lines are shown for the record and are not counted in this version's total.",
            align="R", new_x="LMARGIN", new_y="NEXT",
        )
        pdf.set_text_color(0, 0, 0)
    pdf.ln(4)

    # Consent + signatures
    pdf.set_font("helvetica", size=9)
    pdf.multi_cell(0, 5, _latin1(TEMPLATE["consent_statement"]), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)
    pdf.set_text_color(110, 110, 110)
    pdf.multi_cell(0, 5, _latin1(TEMPLATE["signature_attestation"]), new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)
    pdf.ln(3)

    role_labels = {"contractor": "Contractor", "client": "Client"}
    for signature in data.signatures:
        pdf.set_font("helvetica", size=8)
        pdf.set_text_color(110, 110, 110)
        pdf.cell(0, 5, role_labels.get(signature["signer_role"], signature["signer_role"]).upper(), new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("helvetica", style="I", size=14)
        pdf.cell(0, 8, _latin1(signature["signature_data"]), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("helvetica", size=9)
        signed_at = datetime.fromisoformat(signature["signed_at"].replace("Z", "+00:00"))
        pdf.cell(
            0,
            5,
            _latin1(
                f"Signed by {signature['signer_name']} on {signed_at.strftime('%Y-%m-%d %H:%M %Z')}"
            ),
            new_x="LMARGIN",
            new_y="NEXT",
        )
        pdf.ln(3)

    # Footer disclaimer
    pdf.ln(2)
    pdf.set_font("helvetica", size=7)
    pdf.set_text_color(110, 110, 110)
    pdf.multi_cell(0, 4, _latin1(TEMPLATE["footer_disclaimer"]), new_x="LMARGIN", new_y="NEXT")

    return bytes(pdf.output())
