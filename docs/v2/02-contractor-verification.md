# Feature: Contractor Credential Verification

## Problem
Clients have no easy way to confirm a contractor is legitimate, insured, and
in good standing. Verified credentials also reinforce the platform's overall
trust/compliance story.

## Goal
Allow contractors to submit and display verification of:
- WSIB (Workplace Safety and Insurance Board) clearance certificate
- Liability insurance (commonly $2M minimum) — provider, coverage amount,
  expiry date
- Business registration / good standing status

## Core Flow
1. During or after onboarding, contractor is prompted to upload:
   - WSIB clearance certificate (PDF or photo)
   - Liability insurance certificate (PDF or photo)
   - (Optional) business registration document
2. System stores documents + extracts key fields where possible (expiry
   dates especially — reuse existing parsing pipeline if applicable)
3. Contractor profile displays a "Verified" badge/status once documents are
   submitted, with clear indication of what's been verified and as-of when
4. System should track expiry dates and prompt contractors to re-upload
   before certificates lapse (e.g., 30/14/1 day reminders)
5. Client-facing profile view shows verification status simply — e.g.,
   "WSIB Clearance: Verified (valid until [date])", "Liability Insurance:
   $2M, Verified"

## Verification Levels (consider phased approach)
- **V1 (self-reported / document-on-file):** Contractor uploads certificate,
  platform displays it as "submitted," relies on contractor honesty and
  periodic re-upload prompts. Low engineering lift.
- **V2 (verified):** Cross-check WSIB status via WSIB's public clearance
  lookup (if available) rather than trusting the uploaded document alone.
  Requires research into what WSIB offers programmatically vs. manual lookup.

## Data Model Considerations
- credentials table: contractor_id, credential_type (wsib / liability_insurance
  / business_registration), document_file_ref, issued_date, expiry_date,
  verification_status (self_reported / verified / expired), last_checked_at
- Consider showing coverage amount as a structured field (not just a document)
  for liability insurance so it can be filtered/displayed cleanly.

## Notifications
- Expiry reminders to contractor (in-app + email)
- Consider whether expired credentials should auto-hide the "Verified" badge
  on public profiles until renewed.

## Out of Scope (for now)
- Legal liability for the platform if a contractor's credentials turn out to
  be fraudulent — display clearly that verification reflects submitted
  documents, not a guarantee.
