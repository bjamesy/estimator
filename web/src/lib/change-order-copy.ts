// PLACEHOLDER legal copy -- swap for language from the Ontario
// construction lawyer's vetted template (docs/v2/plans/00-roadmap.md ->
// cross-cutting decision 1). Kept in one exported constant so the swap
// is a one-line change, never hardcoded into components.
//
// Lives apart from lib/signatures.ts because that module uses node:crypto
// (server-only), while this copy renders inside client components.
export const CONSENT_STATEMENT =
  "I have reviewed this change order, including the revised total and " +
  "each changed line item, and I consent to the price change it describes.";
