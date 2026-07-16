# Feature: Public Marketplace / Contractor Portfolios

## Problem
Clients (homeowners) have no easy way to discover contractors with a real,
transparent track record. Contractors have no easy way to showcase completed
work beyond word-of-mouth or generic review sites.

## Goal
Let contractors optionally make selected past projects public, showing specs,
estimate details/budgets, and verified credentials, so clients can browse and
reach out directly through the platform.

## Core Flow
1. Contractor selects a completed project and toggles it to "public" /
   "portfolio" status
2. Contractor can choose what to expose per project:
   - Project description/specs (materials, scope)
   - Budget/estimate totals (full, ranged, or hidden — contractor's choice)
   - Photos (if supported by existing upload pipeline)
3. Public profile page shows:
   - Contractor name/business, verification badges (from
     `02-contractor-verification.md`)
   - List of public projects with specs and (optionally) pricing
   - Contact/inquiry button for clients
4. Clients can browse/search public projects and contractor profiles
   (by location, project type, etc.)
5. Client submits an inquiry through the platform (avoid exposing contractor
   contact info directly at first — route through an inbox/lead system so the
   platform can track engagement)

## Data Model Considerations
- Add visibility/privacy fields to existing project and estimate records
  (e.g., is_public boolean, visible_fields config per project) rather than
  duplicating data into a separate "portfolio" table.
- Leads/inquiries table: client contact info, project_id or contractor_id
  referenced, message, created_at, status (new / responded / closed)

## Search/Browse Considerations
- Filter by location (city/region), project type/category, budget range
- Consider basic geolocation or postal-code-based search given Ontario focus

## Sequencing Note
This feature depends on contractors already having meaningful project data
in the system (from the parsing/estimation core) and, ideally, verification
badges live. Build after the core compliance and credential features, since
it needs real content to be useful and is a secondary retention driver
compared to contractor-facing tools.

## Out of Scope (for now)
- In-app messaging/chat — start with a simple inquiry form that emails the
  contractor and/or creates a lead record.
- Reviews/ratings system — could be a future addition but adds moderation
  overhead; not required for initial marketplace launch.
