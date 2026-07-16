# Implementation Plan: Vendor Price Verification (Spot-Check)

Spec: `../05-vendor-price-check.md`. Priority **3 of 3** in focus.

Attach a specific vendor product URL to a material line item; on demand, fetch the
current listed price and **flag** drift vs. the historical/inflation-adjusted price used
in the estimate. Deliberately narrow: one saved URL per line item, no search/matching,
no scraping engine. Never silently substitute a scraped price.

## What exists today to build on

- `EstimateLine` (`docs/data_model.md`) is the natural anchor — it already holds
  `unit_price` and is a snapshot. The vendor URL and last-check result attach here.
- The system already treats scraped/derived data as **proposals, never silent
  overwrites** (material matching is always visible and correctable; estimate lines are
  snapshots). This feature follows the same principle: a price check flags, it never
  edits the line.
- Async work runs in `workers/` via Celery + `web/src/lib/celery.ts` — the URL fetch
  belongs there (network I/O off the request path, gracefully failable), mirroring the
  existing task pattern.
- **No outbound HTTP fetching of arbitrary URLs exists yet** — this introduces it. Treat
  it with SSRF care (see Phase 2).

## Phase 1 — Attach a vendor URL to a line item

**Goal:** store one vendor product URL per estimate line, captured when the line is
added or later.

Schema (`0020_vendor_price_check.sql`):

```
-- On EstimateLine (or a sibling table if you prefer not to widen it):
ALTER TABLE estimate_lines ADD COLUMN vendor_product_url  text     NULL;

-- Check results are their own record (a line can be checked repeatedly over time):
VendorPriceCheck
  id
  estimate_line_id       FK → EstimateLine
  company_id             FK → Company
  vendor_product_url     text        (URL as fetched — copied so re-check needs no lookup)
  fetched_price          numeric, nullable   (null = fetch/extract failed)
  estimate_price         numeric     (the unit_price the estimate used, at check time)
  outcome                "confirmed" | "changed" | "unverifiable"
  checked_at             timestamptz
  created_at
```

- Company-scoped RLS on `VendorPriceCheck` (copy `0004_rls_policies.sql`). Append-only
  history of checks per line — never overwrite a prior check; the latest row is the
  current state.
- Storing `vendor_product_url` on the check row too (not just the line) means a re-check
  is a pure re-fetch of a known URL — **no search/matching logic**, exactly per spec
  §Technical Notes.

Actions (`web/src/app/actions/vendor-price.ts`, new file):

- `setLineVendorUrl(estimateLineId, url)` — validates and stores the URL (validate
  scheme/host allowlist here too; see Phase 2).
- `checkLinePrice(estimateLineId)` — publishes the fetch task; the UI shows a pending
  state, then the result.

## Phase 2 — Per-vendor fetch & extraction (worker)

**Goal:** fetch the saved URL, extract the current price for that specific product, fail
gracefully.

- New Celery task `check_vendor_price(vendor_price_check_id, company_id, url)` published
  via a new `web/src/lib/celery.ts` wrapper (`publishCheckVendorPriceTask`).
- **Small per-vendor extraction layer**, not a generic scraper (spec §Technical Notes):
  - Start with the **1–2 vendors most common among early contractors** (likely Home
    Depot / Rona / Home Hardware — confirm from real usage). Each vendor gets a small
    extractor that reads price from a predictable spot (JSON-LD / `og:` meta /
    structured data first; DOM selector as fallback).
  - **Fail gracefully**: on any failure (layout change, blocked, wrong variant, out of
    stock, timeout), write `outcome = "unverifiable"`, `fetched_price = null`. **Never
    error the estimate** — the estimate keeps using historical + inflation pricing.
- **Security — this is new outbound-fetch surface**, treat with care:
  - Allowlist vendor hosts; reject anything off-list at `setLineVendorUrl` time and again
    at fetch time.
  - SSRF guard: reject non-public IPs / internal hostnames / non-https schemes; cap
    response size and follow-redirect count; short timeout.
  - Respect vendor ToS / robots — low-frequency, single-item, user-initiated checks
    (spec §Technical Notes). Do not batch or crawl.
- **LLM optional, not default:** the price is usually in structured data; reach for a
  Claude call only if a vendor's page resists deterministic extraction. Keep the default
  path dependency-light.

## Phase 3 — Compare, flag, and stamp

**Goal:** turn a fetched price into a clear, non-destructive signal on the estimate.

- Comparison logic (in the action or a small lib, after the worker writes the result):
  - **Materially unchanged** (within a tolerance, e.g. ±X%): `outcome = "confirmed"`,
    show a positive indicator — "Price confirmed — no change since your last order
    (checked [date])".
  - **Changed**: `outcome = "changed"`, show a clear flag — "Vendor price appears to
    have changed to $X (was $Y). Estimate is still using historical + inflation pricing.
    Review recommended." — with a manual "update this line to $X" action the contractor
    chooses to take. **Never auto-substitute** (spec §Core Flow 3).
  - **Unverifiable**: neutral message — "Couldn't verify current price — using
    historical + inflation estimate."
- Store `checked_at` as the "price last verified on [date]" stamp. Surface it on the
  line and carry it into the estimate/change-order PDF (feature 01, Phase 4) — this is
  the tie-in to the compliance audit trail (spec §Core Flow 4).

## Open decision (per spec §Open Decision)

When do checks run?
- **(a) once at estimate/version creation** — simpler; **recommended for v1**.
- **(b) periodically while an estimate is pending/unsigned** — better for the "estimate
  stays fresh until signed" compliance story, but adds background jobs + drift
  re-notification.

**Recommendation: ship (a); revisit (b)** once feature 01's signing lifecycle and
reminder infra exist — at that point (b) is a natural extension (re-check pending,
unsigned versions on the same sweep that sends signature reminders).

## Out of scope (per spec)

- Multi-vendor comparison / "best price" recommendations.
- Automatic re-pricing of estimates from scraped data.
- Vendors without a stable, scrapable product page.

## Sequencing within this feature

1 → 2 → 3. Phase 1 (attach URL + schema) is trivial and unblocks the rest. Phase 2 is
the real work (fetch, per-vendor extractors, SSRF/ToS care). Phase 3 is presentation +
the manual-update affordance. Build after feature 01 so the "verified on" stamp has the
PDF/audit-trail surface to land in, and so option (b) can reuse 01's reminder sweep.
