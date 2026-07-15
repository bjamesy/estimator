import { TriangleAlertIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// Shared read-only rendering of a frozen estimate version, used by both
// the contractor-facing version page and the public client signing page
// (/sign/[token]) so the client reviews exactly what the contractor saw.
// Presentational only -- no data fetching, no actions.

export type VersionLine = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  markup_percent: number;
  total: number;
  change_kind: string;
};

export type Signature = {
  signer_role: string;
  signer_name: string;
  signature_data: string;
  signed_at: string;
};

// Human labels + styling per change_kind. Removed rows are shown struck
// through and are excluded from the version's total (see
// 0016_estimate_versions.sql).
const CHANGE_BADGES: Record<string, { label: string; className: string } | null> = {
  unchanged: null,
  added: { label: "Added", className: "border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  modified: { label: "Changed", className: "border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  removed: { label: "Removed", className: "border-transparent bg-muted text-muted-foreground" },
};

export function CpaCallout({
  pct,
  forClient = false,
  executed = false,
}: {
  pct: number;
  forClient?: boolean;
  executed?: boolean;
}) {
  // Post-execution the callout is a record, not a call to action --
  // "get this signed" would be stale next to two signatures.
  const body = executed
    ? "Ontario's Consumer Protection Act requires documented client consent for cost increases of 10% or more over the original estimate. The signatures on this document record that consent."
    : forClient
      ? "Ontario's Consumer Protection Act requires your documented consent for cost increases of 10% or more over the original estimate — that is what signing this change order provides."
      : "Ontario's Consumer Protection Act requires documented client consent for cost increases of 10% or more over the original estimate. Get this change order signed before proceeding with the work.";
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
      <TriangleAlertIcon className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400" />
      <div className="text-sm">
        <p className="font-semibold text-amber-800 dark:text-amber-300">
          {pct.toFixed(1)}% over the original estimate
        </p>
        <p className="text-amber-800/90 dark:text-amber-300/90">{body}</p>
      </div>
    </div>
  );
}

export function VersionTotals({
  rootTotal,
  versionTotal,
  pct,
}: {
  rootTotal: number | null;
  versionTotal: number;
  pct: number | null;
}) {
  const overThreshold = pct !== null && pct >= 10;
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
      {rootTotal !== null && (
        <span className="text-muted-foreground">
          Original estimate (v1):{" "}
          <span className="font-medium text-foreground">${rootTotal.toFixed(2)}</span>
        </span>
      )}
      <span className="text-muted-foreground">
        This version:{" "}
        <span className="font-medium text-foreground">${versionTotal.toFixed(2)}</span>
      </span>
      {pct !== null && (
        <span
          className={cn(
            "font-medium",
            overThreshold ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
          )}
        >
          {pct >= 0 ? "+" : ""}
          {pct.toFixed(1)}% vs. original
        </span>
      )}
    </div>
  );
}

export function VersionLinesTable({
  lines,
  versionTotal,
}: {
  lines: VersionLine[];
  versionTotal: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead className="text-right">Markup %</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => {
              const removed = line.change_kind === "removed";
              const badge = CHANGE_BADGES[line.change_kind];
              return (
                <TableRow
                  key={line.id}
                  className={cn(removed && "text-muted-foreground line-through opacity-70")}
                >
                  <TableCell>{line.description}</TableCell>
                  <TableCell className="text-right">{line.quantity}</TableCell>
                  <TableCell className="text-right">${line.unit_price.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{line.markup_percent}%</TableCell>
                  <TableCell className="text-right">${line.total.toFixed(2)}</TableCell>
                  <TableCell>
                    {badge && <Badge className={badge.className}>{badge.label}</Badge>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col items-end gap-1">
        <p className="text-right text-sm font-medium">
          Version total: ${versionTotal.toFixed(2)}
        </p>
        {lines.some((l) => l.change_kind === "removed") && (
          <p className="text-right text-xs text-muted-foreground">
            Removed lines are shown struck through and are not counted in this
            version&apos;s total.
          </p>
        )}
      </div>
    </div>
  );
}

const ROLE_LABELS: Record<string, string> = {
  contractor: "Contractor",
  client: "Client",
};

// An executed signature, rendered read-only. signature_data is the typed
// name the signer adopted (v1 in-house capture -- see lib/signatures.ts).
export function SignatureBlock({ signature }: { signature: Signature }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {ROLE_LABELS[signature.signer_role] ?? signature.signer_role}
      </p>
      <p className="font-serif text-xl italic">{signature.signature_data}</p>
      <p className="text-sm text-muted-foreground">
        Signed by {signature.signer_name} on{" "}
        {new Date(signature.signed_at).toLocaleString()}
      </p>
    </div>
  );
}
