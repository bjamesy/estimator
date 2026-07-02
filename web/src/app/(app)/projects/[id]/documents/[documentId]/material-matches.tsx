"use client";

import { useEffect, useState } from "react";

import { flagMaterialMatch } from "@/app/actions/materials";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";

type LineItem = { id: string; description: string };
type MatchRow = { id: string; line_item_id: string; status: string; material_name: string };

const POLL_INTERVAL_MS = 2000;
// match_materials has no DocumentProcessingEvent-equivalent to signal a
// terminal failure (see workers/estimator_workers/tasks.py), so this
// component can't distinguish "still running" from "failed and never
// will finish." Capping the poll count at least stops polling forever and
// tells the user something's wrong instead of showing "matching..."
// indefinitely -- full failure visibility would need a backend change.
const MAX_POLL_ATTEMPTS = 30; // ~1 minute at POLL_INTERVAL_MS

export function MaterialMatches({
  projectId,
  documentId,
  lineItems,
  initialMatches,
}: {
  projectId: string;
  documentId: string;
  lineItems: LineItem[];
  initialMatches: MatchRow[];
}) {
  const [matches, setMatches] = useState(initialMatches);
  const [flagging, setFlagging] = useState<string | null>(null);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [pollAttempts, setPollAttempts] = useState(0);

  useEffect(() => {
    setMatches(initialMatches);
    setPollAttempts(0);
  }, [initialMatches]);

  useEffect(() => {
    if (matches.length >= lineItems.length) return;
    if (pollAttempts >= MAX_POLL_ATTEMPTS) return;

    const supabase = createClient();
    let cancelled = false;
    const lineItemIds = lineItems.map((li) => li.id);

    async function poll() {
      const { data } = await supabase
        .from("material_matches")
        .select("id, line_item_id, status, material_catalog(name)")
        .in("line_item_id", lineItemIds);

      if (cancelled || !data) return;

      setMatches(
        data.map((m) => ({
          id: m.id,
          line_item_id: m.line_item_id,
          status: m.status,
          material_name: (m.material_catalog as unknown as { name: string } | null)?.name ?? "—",
        })),
      );
      setPollAttempts((prev) => prev + 1);
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches.length, lineItems.length, pollAttempts >= MAX_POLL_ATTEMPTS]);

  async function handleFlag(matchId: string) {
    setFlagging(matchId);
    setFlagError(null);
    const { error } = await flagMaterialMatch(matchId, projectId, documentId);
    if (error) {
      setFlagError(error);
    } else {
      setMatches((prev) => prev.map((m) => (m.id === matchId ? { ...m, status: "flagged" } : m)));
    }
    setFlagging(null);
  }

  const stillMatching = matches.length < lineItems.length;
  const timedOut = stillMatching && pollAttempts >= MAX_POLL_ATTEMPTS;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Materials</h2>
      {stillMatching && !timedOut && (
        <p className="text-sm text-muted-foreground">Matching against material catalog...</p>
      )}
      {timedOut && (
        <p className="text-sm text-destructive">
          Matching is taking longer than expected and may have failed. The line items already
          matched below are still correct; the rest may need a page refresh to pick up later, or
          may never complete.
        </p>
      )}
      {flagError && <p className="text-sm text-destructive">{flagError}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Line item</TableHead>
            <TableHead>Matched material</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lineItems.map((li) => {
            const match = matches.find((m) => m.line_item_id === li.id);
            return (
              <TableRow key={li.id}>
                <TableCell className="max-w-xs truncate">{li.description}</TableCell>
                <TableCell>
                  {match ? (
                    <div className="flex items-center gap-2">
                      <span>{match.material_name}</span>
                      {match.status === "flagged" && <Badge variant="destructive">flagged</Badge>}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">
                      {timedOut ? "never matched" : "matching..."}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {match && match.status === "proposed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={flagging === match.id}
                      onClick={() => handleFlag(match.id)}
                    >
                      {flagging === match.id ? "Flagging..." : "Flag as wrong"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
