# Feature: Change Order & Compliance Documents

## Problem
Ontario's Consumer Protection Act restricts contractors from charging more than
10% over a given estimate without documented client approval. Most small
contractors track scope changes informally (texts, verbal agreements, napkin
math), leaving them exposed to disputes and unable to prove client consent.

## Goal
Turn every estimate revision into a formal, signed, timestamped document that:
- Shows the original estimate, the proposed change, and the new total
- Requires contractor signature, then client signature
- Is stored with full audit trail (timestamps, IP/device metadata optional)
- Is exportable/searchable as a PDF

## Core Flow
1. Contractor edits an existing estimate (adds material, changes scope, etc.)
2. System detects the change and calculates the new total and % delta vs. original
3. If the new total exceeds the original by 10% or more, flag this prominently
   in the UI (this is the CPA threshold that requires documented consent)
4. System generates a new versioned document:
   - Original estimate line items (read-only, preserved)
   - New/changed line items highlighted
   - Old total, new total, % change
   - Signature block for contractor, signature block for client
5. Contractor signs first (in-app signature + timestamp)
6. Document is sent to client (email/link) for their signature
7. Once client signs, both signatures + timestamps are locked to the document
8. Final signed PDF + metadata stored in database, linked to the project/estimate

## Data Model Considerations
- Estimates should be versioned, not overwritten. Each revision is a new
  immutable record linked to the previous version (parent_estimate_id or similar).
- Each version needs: created_at, contractor_signed_at, client_signed_at,
  status (draft / pending_contractor_signature / pending_client_signature / executed),
  pct_change_from_original, original_estimate_id (root reference).
- Store the rendered PDF (or enough data to deterministically regenerate it)
  alongside structured data — the PDF is the legal artifact, structured data is
  for search/filtering.

## Document Template
- The actual legal language/format of this document should come from a
  template reviewed by an Ontario construction lawyer. Do not hardcode legal
  clauses without review — build the feature so the template content is
  swappable/configurable.
- Required elements to leave room for in the template: clear scope description,
  cost breakdown, both parties' identifying info, signature + date fields,
  statement of consent to the price change.

## Notifications
- Client should receive a clear, simple notification (email/SMS) when a
  document is waiting for their signature.
- Contractor should be notified when the client signs (or if they haven't
  after some period, e.g., a reminder after 3-5 days).

## Out of Scope (for now)
- Automated legal enforcement — the app is not providing legal advice, only
  producing documentation that is intended to hold up if reviewed/vetted.
- E-signature legal certification (e.g., DocuSign-level certification) —
  evaluate later whether a compliant e-signature provider is needed vs.
  building in-house signature capture.
