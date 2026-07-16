// Derives an estimate's list-page status bucket from its latest
// estimate_versions row. The estimates table itself has no status column --
// this is the single source of truth for turning version lifecycle into a
// small set of buckets a contractor actually cares about.
//
// Add "declined" here (once the client-facing decline action exists on
// /sign/[token]) plus one more ESTIMATE_STATUS_TABS entry and one more case
// in deriveEstimateStatusBucket. Nothing else needs to change shape.
export type RawVersionStatus =
  | "draft"
  | "pending_contractor_signature"
  | "pending_client_signature"
  | "executed"
  | "superseded";

export type EstimateStatusBucket = "draft" | "pending" | "confirmed";

export const ESTIMATE_STATUS_TABS: { key: EstimateStatusBucket; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "pending", label: "Pending" },
  { key: "confirmed", label: "Confirmed" },
];

export const VERSION_STATUS_LABELS: Record<RawVersionStatus, string> = {
  draft: "Draft",
  pending_contractor_signature: "Awaiting your signature",
  pending_client_signature: "Awaiting client signature",
  executed: "Executed",
  superseded: "Superseded",
};

export function deriveEstimateStatusBucket(
  latestVersionStatus: string | null,
): EstimateStatusBucket {
  switch (latestVersionStatus) {
    case null:
    case "draft":
      return "draft";
    case "pending_contractor_signature":
    case "pending_client_signature":
      return "pending";
    case "executed":
      return "confirmed";
    default:
      // "superseded" should never be the latest version in correct
      // operation. If it somehow is (or the column holds an unexpected
      // value), fall back to Draft rather than throw or falsely claim
      // Confirmed.
      return "draft";
  }
}
