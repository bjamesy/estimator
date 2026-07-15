# Product Walkthrough

How Estimator is actually used, end to end, as of the `v2/change-orders` branch.
This is the user journey; see `docs/architecture.md` for system design and
`docs/data_model.md` for schema. Feature intent lives in `docs/v2/*.md` specs —
this doc describes what's actually built and how it behaves, including known
gaps, so it doesn't drift from reality the way spec docs tend to.

## 1. Onboarding

A contractor signs up and creates a company. All data is company-scoped — no
cross-company sharing.

They're prompted to upload credentials: WSIB clearance certificate and
liability insurance (business registration optional). This is **V1
"document-on-file" verification** — the system extracts fields like expiry
date via the same vision-LLM pipeline used for invoices, and displays a
"Verified" badge based on the document being on file. There is **no
independent cross-check** against WSIB's own database yet (`docs/v2/plans/00-roadmap.md`
tracks this as an open, unbuilt spike). Expiry reminders fire at 30/14/1 days
before a credential lapses, then auto-expire.

## 2. The core loop — building the historical price memory

This is the MVP and the reason the product exists. The contractor uploads
purchasing documents (invoices, receipts, PDFs) into a Project. A vision LLM
extracts structured line items (supplier, date, material, qty, unit price,
total) from each document; the contractor confirms the extraction; confirmed
items get promoted into the **company-wide historical record**.

Material matching groups similar line items under a canonical material (e.g.
different invoice wordings for "PT 2x8" all group together). This is always
visible and correctable, and a flagged match never changes the underlying
line item or original document — documents are the source of truth.

## 3. Estimating

When building an Estimate, the contractor searches that historical record
("what did I pay for PT 2x8s last year") and pulls real historical prices +
a markup into estimate line items. An estimate may optionally reference a
Project but isn't required to — estimates are company-wide, not
project-scoped.

## 4. Change orders — the legal/compliance layer

If the contractor edits an existing estimate (adds material, changes scope),
the system doesn't overwrite it — it creates a new **immutable version**
linked to the original. It calculates the % change from the original total;
if that crosses **10%**, it flags this prominently (Ontario's Consumer
Protection Act requires documented client consent above that threshold).

Flow: contractor signs in-app first → system emails the client a tokenized
`/sign/[token]` link (no client account needed) → client reviews and signs →
once both signatures land, the version is locked as "executed" and a legal
PDF is rendered worker-side.

**Known gaps in this flow today:**
- The PDF's legal language is a **placeholder template** — the actual clauses
  are pending review from an Ontario construction lawyer. The feature is
  built template-agnostic (no hardcoded legal language) specifically so the
  real template can be swapped in later without a rebuild.
- Email notifications (client "please sign," contractor "they signed," and
  reminders after 3–5 days if unsigned) go out via Resend, but **this
  environment runs on console transport** — no `RESEND_API_KEY` is set, so
  emails are logged to the worker console, not actually delivered. Don't
  assume a client has been notified without checking the worker logs or
  setting the key.

## 5. Vendor price spot-check

An optional, on-demand check: attach a specific vendor product URL to an
estimate line item, and the system fetches it to see if the live price has
drifted from what the estimate used. Never auto-substitutes — it only flags
("confirmed" / "changed" / "unverifiable") and lets the contractor manually
decide whether to update the line.

**This is the least reliable part of the product today** (see investigation
notes below). Treat any "changed" result with skepticism until the known
issues are addressed.

### Known issues (found 2026-07-14, not yet fixed)

- **No live update.** The check runs async via Celery; the estimate page is
  server-rendered and has no polling/realtime subscription, so the result
  only appears after a manual page refresh.
- **Cloudflare bot walls.** At least Home Hardware intermittently serves a
  Cloudflare "managed challenge" page instead of real content to the
  fetcher, with no retry — that check silently comes back `unverifiable`.
- **Store-specific pricing isn't reachable at all.** Home Hardware's raw
  server-rendered HTML only contains a generic national "List" price — the
  real, store-specific price is fetched by client-side JavaScript after page
  load, resolved via Cloudflare edge geolocation (no cookie needed, just
  request IP). A plain HTTP fetch never triggers that call, so it can only
  ever see the (possibly wrong) list price. Fixing this would require
  headless-browser JS execution *and* solve a second problem — the
  resolved store would be based on our server's IP, not the contractor's,
  so it could easily surface a different store's price entirely. There's no
  clean fix under the current data model (no "which store do you buy from"
  field exists).
- Home Depot and Rona haven't been spot-checked yet for the same issues —
  don't assume they're clean.
- The original spec's "reliable verification" premise may not hold for any
  of the three allowlisted vendors. Revisit before investing further here —
  see the open question in `docs/v2/plans/00-roadmap.md` on deferred option
  (b) (periodic re-checks while pending).

## Not built yet

- **Marketplace** — backlogged, no implementation plan exists.
- **Project Templates** — backlogged, no implementation plan exists.
