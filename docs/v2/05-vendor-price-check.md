# Feature: Vendor Price Verification (Spot-Check)

## Problem
Current estimates are based on historical project materials plus an inflation
adjustment. This is reasonable but not verified against real, current vendor
pricing, which reduces confidence in estimate accuracy.

## Goal
For a given estimate, allow spot-checking at least one material line item
against its actual current price on a vendor's website, and clearly flag
whether the historical/inflation-adjusted price appears to still hold or has
diverged.

## Scope (Intentionally Narrow for V1)
- Do NOT build a general pricing engine or scraper across many vendors.
- Support checking a single saved vendor product URL per material line item,
  not a search/match system.

## Core Flow
1. When a contractor adds a material line item to a project/estimate (or
   later, when reviewing one), they can optionally attach a specific vendor
   product page URL (e.g., a specific SKU on Home Depot / Rona / Home
   Hardware's site)
2. On demand (or at estimate-creation time), the system fetches that URL and
   extracts the current listed price for that specific product
3. Compare fetched price to the historical/inflation-adjusted price used in
   the estimate:
   - **If price is materially unchanged:** show a positive confidence
     indicator — e.g., "Price confirmed — no change since your last order
     (checked [date])"
   - **If price has changed:** do NOT silently substitute the scraped price
     into the estimate (scraped prices can reflect sales, wrong variants, or
     stock issues). Instead, flag it clearly — e.g., "Vendor price appears to
     have changed to $X (was $Y). Estimate is still using historical +
     inflation pricing. Review recommended." — and let the contractor decide
     whether to manually update the line item.
4. Store a "price last verified on [date]" timestamp on the estimate/line
   item so this can be referenced later (ties into the compliance/audit
   trail from `01-change-orders-compliance.md`).

## Technical Notes
- Store the vendor product URL per line item at the time it's first entered,
  so re-checking later doesn't require search/matching logic — just re-fetch
  the same URL.
- Build a small per-vendor extraction layer (price is typically in a
  predictable location in the page's HTML/structured data) rather than a
  generic scraper. Start with whichever 1-2 vendors are most common among
  early contractor users.
- Expect this to break when vendors change their site layout — fail
  gracefully (e.g., "Couldn't verify current price — using historical +
  inflation estimate") rather than erroring the whole estimate.
- Respect vendor terms of service; this is a low-frequency, single-item
  check rather than bulk scraping, which reduces (but doesn't eliminate) risk.

## Open Decision
Decide whether price checks happen:
(a) once at estimate creation only, or
(b) periodically while an estimate is still pending/unsigned by the client.
Option (b) is more useful for the compliance story (estimate stays "fresh"
until signed) but adds complexity (background jobs, re-notifying contractor
of drift). Recommend starting with (a) and revisiting (b) later.

## Out of Scope (for now)
- Multi-vendor price comparison or "best price" recommendations
- Automatic re-pricing of estimates based on scraped data
- Support for vendors without a stable, scrapable product page structure
