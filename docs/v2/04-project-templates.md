# Feature: Open Project Templates ("GitHub for Construction Projects")

## Problem
Clients rarely return to the platform (they hire a contractor once every few
years), so client-driven growth alone is weak. Contractors, however, are
frequent users. Giving contractors a reason to browse and contribute content
— not just manage their own projects — drives retention and network effects.

## Goal
Let contractors publish reusable "templates" of past projects — material
lists, scope, and (optionally) estimate structure — that other contractors
can browse, fork, and adapt for their own bids, similar to forking a
repository.

## Core Flow
1. Contractor selects a completed (or in-progress) project and chooses to
   "publish as template"
2. Contractor selects what's included in the template:
   - Material list (types/quantities — likely without contractor's specific
     historical pricing, or with pricing anonymized/optional)
   - Scope/description structure
   - Category/tags (e.g., "kitchen renovation," "deck build," "basement
     finishing") for discoverability
3. Published templates appear in a browsable/searchable template library
4. Any contractor can "fork" a template:
   - Creates a new project/estimate in their own account pre-populated with
     the template's material list and structure
   - They then adjust quantities, swap in their own vendor pricing, add/remove
     items as needed
5. Track fork counts / usage on the original template (visible to the
   original author) as a lightweight recognition/incentive mechanism

## Data Model Considerations
- templates table: source_project_id, contractor_id (author), title,
  category/tags, visibility, fork_count, created_at
- Forking should copy structured line-item data into a new project/estimate
  owned by the forking contractor — not a live link back to the original
  (avoid unintentional shared-state bugs)
- Consider whether pricing data is included by default or stripped out;
  material types/quantities are the primary value, pricing may be sensitive
  or simply stale for another contractor's region/vendor

## Discoverability
- Category/tag browsing to start (renovation type, room type, etc.)
- Search by material or project type
- Consider a simple "most forked" or "recently added" sort to surface useful
  templates early when the library is small

## Sequencing Note
This is a strong candidate for an early, low-dependency build — it doesn't
require the marketplace or verification features to provide value, and it
directly targets contractor retention/return visits, which the discussion
identified as the actual growth bottleneck (clients are infrequent users).

## Out of Scope (for now)
- Formal licensing terms for shared templates — for now assume templates
  are shared under simple platform terms (e.g., contractor grants other
  users the right to fork/reuse), not a formal open-source license scheme.
- Monetization/paid templates — pure open sharing model for v1.
