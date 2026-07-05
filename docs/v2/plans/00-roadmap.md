# v2 Implementation Roadmap

Derived from the specs in `docs/v2/`. This roadmap covers only the **in-focus**
features. Marketplace (`03`) and Project Templates (`04`) are **backlogged as the
final two priorities** and have no implementation plan yet.

## Priority order

| # | Feature | Spec | Plan |
|---|---------|------|------|
| 1 | Change Order & Compliance Documents | `01-change-orders-compliance.md` | `plans/01-change-orders-plan.md` |
| 2 | Contractor Verification | `02-contractor-verification.md` | `plans/02-verification-plan.md` |
| 3 | Vendor Price Verification | `05-vendor-price-check.md` | `plans/05-vendor-price-check-plan.md` |
| — | Marketplace | `03-marketplace.md` | *backlogged* |
| — | Project Templates | `04-project-templates.md` | *backlogged* |

Change Orders is first because it is the legal wedge **and** because it builds three
foundations the other two reuse:

- **Estimate versioning** (immutable revisions) — the substrate for any "as sent to
  client" artifact, including a price-checked estimate.
- **Signature capture + status lifecycle** — a document that moves through
  draft → signed states.
- **PDF rendering** of an estimate/change-order — the legal artifact, and later the
  export surface the price-check "verified on" stamp lands in.

## Grounding in the current system

These plans assume the MVP schema and architecture described in `docs/data_model.md`
and `docs/architecture.md`. Key conventions every plan below follows:

- **Migrations** are sequential SQL files in `database/migrations/`. The last shipped
  is `0015_estimate_line_soft_delete.sql`, so new work starts at **`0016`**. Numbers
  below are indicative; renumber to whatever is next-unused at build time.
- **Company scoping**: every new table carries a denormalized `company_id` and an RLS
  policy scoped by it (`docs/architecture.md` → Company Scoping). Next.js actions
  additionally scope by the authenticated user's `company_id` (defense in depth).
- **Web mutations** are Server Actions in `web/src/app/actions/*.ts`. New features add
  new files there rather than bloating existing ones.
- **Async work** (LLM calls, URL fetches) runs in `workers/` via Celery, published
  from Next.js through `web/src/lib/celery.ts` (`publishTask`), never inline in a
  request. Add a new publisher wrapper per new task, mirroring
  `publishMatchMaterialsTask`.
- **Immutability / source-of-truth**: legal artifacts and signed documents follow the
  same `ON DELETE RESTRICT`, never-overwrite discipline the `Document → Invoice →
  LineItem` chain already uses (`docs/data_model.md`).

## Cross-cutting decisions to make before Feature 1

These are flagged for the founder, not for engineering to resolve unilaterally:

1. **Legal template source** (confirmed): the change-order document language will be
   a **swappable template approved by an Ontario construction lawyer**, supplied
   later. Engineering builds the feature template-agnostic; no legal clauses are
   hardcoded. See `01-change-orders-plan.md` → Phase 4.
2. **E-signature depth**: in-house signature capture (draw/type + timestamp + audit
   metadata) for v1, versus integrating a certified e-signature provider (DocuSign-
   class) later. Plans assume in-house capture for v1 with a clean seam to swap in a
   provider. See `01-change-orders-plan.md` → Phase 3.
3. **Client identity**: clients (homeowners) are not users today. The change-order
   flow needs a lightweight, no-account client-signing path (tokenized link). See
   `01-change-orders-plan.md` → Phase 3.
