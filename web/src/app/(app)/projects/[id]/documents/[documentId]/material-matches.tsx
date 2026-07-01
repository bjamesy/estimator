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

  useEffect(() => {
    setMatches(initialMatches);
  }, [initialMatches]);

  useEffect(() => {
    if (matches.length >= lineItems.length) return;

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
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches.length, lineItems.length]);

  async function handleFlag(matchId: string) {
    setFlagging(matchId);
    await flagMaterialMatch(matchId, projectId, documentId);
    setMatches((prev) => prev.map((m) => (m.id === matchId ? { ...m, status: "flagged" } : m)));
    setFlagging(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Materials</h2>
      {matches.length < lineItems.length && (
        <p className="text-sm text-muted-foreground">Matching against material catalog...</p>
      )}
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
                    <span className="text-muted-foreground">matching...</span>
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
