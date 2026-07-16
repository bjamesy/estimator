# Product Overview: Ontario Contractor Estimation Platform

## Current State
The application already supports:
- Uploading invoices/receipts via photo or PDF
- Parsing materials and totals from those documents
- Surfacing parsed data as projects and estimates
- Creating estimates from historical project data

## Strategic Direction
The product is expanding from a personal estimation tool into an Ontario-specific
platform with legal, marketplace, and network-effect dimensions. The features
below represent that expansion, grouped by priority (not by spec number).
Phased implementation plans for the in-focus features live in `plans/`
(start at `plans/00-roadmap.md`).

### In focus — build now (in this order)

1. **Change Order & Compliance Documents** (`01-change-orders-compliance.md`)
   Legally-informed, signed change order/estimate documents tied to Ontario's
   Consumer Protection Act 10% overage rule. The core trust/legal wedge — and it
   establishes shared building blocks (estimate versioning, signature capture,
   PDF rendering) the other in-focus features reuse.
   Plan: `plans/01-change-orders-plan.md`.

2. **Contractor Verification** (`02-contractor-verification.md`)
   WSIB clearance, liability insurance, and registration verification surfaced
   on contractor profiles. Reuses the existing extraction pipeline for cert parsing.
   Plan: `plans/02-verification-plan.md`.

3. **Vendor Price Verification** (`05-vendor-price-check.md`)
   Spot-check one material line item per estimate against a saved vendor product
   URL to confirm or flag price drift versus historical + inflation estimate.
   Feeds the compliance audit trail from feature 01.
   Plan: `plans/05-vendor-price-check-plan.md`.

### Backlogged — the final two priorities
Deferred until the in-focus features ship and there's real contractor activity and
content to browse. No implementation plans yet.

4. **Marketplace** (`03-marketplace.md`)
   Public contractor portfolios (past projects, specs, estimates) that clients
   can browse, paired with verified credentials, to generate leads. Needs real
   content and live verification badges before it's useful.

5. **Open Project Templates** ("GitHub for construction projects")
   (`04-project-templates.md`)
   Contractors publish reusable material lists / project blueprints that other
   contractors can fork and adapt. A strong network-effect driver, but sequenced
   last per the current priority call.

## Sequencing Note
Contractors, not clients, should be treated as the primary user and retention
driver (clients only need a contractor rarely). Features are built to keep
contractors returning first (change orders, compliance, price checks), with the
marketplace and templates acting as downstream benefits once there's real
contractor activity and content to browse.

## Open Legal Question (flag for founder, not for engineering to resolve)
The change order / estimate documents referenced in `01-change-orders-compliance.md`
should be reviewed by an Ontario construction/contract lawyer before being treated
as legally binding. Engineering can build the feature assuming a legally-vetted
template will be supplied; do not invent legal language.
