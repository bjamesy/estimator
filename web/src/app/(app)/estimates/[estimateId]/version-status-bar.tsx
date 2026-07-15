import { Badge } from "@/components/ui/badge";
import { type RawVersionStatus, VERSION_STATUS_LABELS } from "@/lib/estimate-status";

import { SnapshotVersionForm } from "./snapshot-version-form";

// Pinned to the viewport bottom rather than living at the end of the page
// flow -- snapshotting is the single most consequential action here (it's
// what turns a draft into a signable legal document), so it should be
// reachable without scrolling past the whole draft first, not just
// "eventually reachable" once you happen to scroll far enough.
export function VersionStatusBar({
  estimateId,
  latestVersion,
  nextVersionNumber,
  grandTotal,
  draftOverCpaThreshold,
}: {
  estimateId: string;
  latestVersion: { version_number: number; status: string } | null;
  nextVersionNumber: number;
  grandTotal: number;
  draftOverCpaThreshold: boolean;
}) {
  return (
    // md:left-64 matches the sidebar's fixed w-64 in app-shell.tsx -- without
    // it, this bar's centered max-w-6xl content is measured against the full
    // viewport width instead of the space after the sidebar, so it drifts
    // left of the actual content column (including the builder panel) above it.
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:left-64">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium">${grandTotal.toFixed(2)}</span>
          {latestVersion ? (
            <Badge variant="outline">
              Version {latestVersion.version_number} ·{" "}
              {VERSION_STATUS_LABELS[latestVersion.status as RawVersionStatus] ??
                latestVersion.status}
            </Badge>
          ) : (
            <span className="text-muted-foreground">No versions yet</span>
          )}
          {draftOverCpaThreshold && (
            <span className="font-medium text-amber-700 dark:text-amber-400">
              10%+ over original — snapshot for signed consent
            </span>
          )}
        </div>
        <SnapshotVersionForm estimateId={estimateId} nextVersionNumber={nextVersionNumber} />
      </div>
    </div>
  );
}
