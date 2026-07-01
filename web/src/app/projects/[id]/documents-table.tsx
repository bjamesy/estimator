"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";

type Document = {
  id: string;
  storage_path: string;
  status: string;
  created_at: string;
};

type LatestEvent = {
  stage: string;
  status: "started" | "succeeded" | "failed";
  error_message: string | null;
} | null;

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  pending: "secondary",
  confirmed: "default",
  failed: "destructive",
};

const POLL_INTERVAL_MS = 2000;

export function DocumentsTable({ documents: initialDocuments }: { documents: Document[] }) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [latestEvents, setLatestEvents] = useState<Record<string, LatestEvent>>({});

  // initialDocuments is a fresh array every time the parent Server
  // Component re-renders (e.g. after revalidatePath on upload) -- useState's
  // initializer only runs on mount, so without this the table would never
  // show newly uploaded documents until a full page reload.
  useEffect(() => {
    setDocuments(initialDocuments);
  }, [initialDocuments]);

  useEffect(() => {
    const pendingIds = documents.filter((d) => d.status === "pending").map((d) => d.id);
    if (pendingIds.length === 0) return;

    const supabase = createClient();
    let cancelled = false;

    async function poll() {
      const [{ data: docs }, { data: events }] = await Promise.all([
        supabase.from("documents").select("id, storage_path, status, created_at").in("id", pendingIds),
        supabase
          .from("document_processing_events")
          .select("document_id, stage, status, error_message, started_at")
          .in("document_id", pendingIds)
          .order("started_at", { ascending: false }),
      ]);

      if (cancelled) return;

      if (docs) {
        setDocuments((prev) => prev.map((d) => docs.find((updated) => updated.id === d.id) ?? d));
      }

      if (events) {
        setLatestEvents((prev) => {
          const next = { ...prev };
          for (const documentId of pendingIds) {
            const latest = events.find((e) => e.document_id === documentId);
            if (latest) {
              next[documentId] = {
                stage: latest.stage,
                status: latest.status,
                error_message: latest.error_message,
              };
            }
          }
          return next;
        });
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // Re-run only when the set of pending document ids changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents.map((d) => (d.status === "pending" ? d.id : null)).join(",")]);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>File</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Uploaded</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((doc) => {
          const latest = latestEvents[doc.id];
          return (
            <TableRow key={doc.id}>
              <TableCell className="max-w-xs truncate">
                {doc.storage_path.split("/").pop()}
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <Badge variant={STATUS_VARIANT[doc.status] ?? "secondary"}>{doc.status}</Badge>
                  {doc.status === "pending" && latest && (
                    <span className="text-xs text-muted-foreground">
                      {latest.stage}: {latest.status}
                    </span>
                  )}
                  {doc.status === "failed" && latest?.error_message && (
                    <span className="max-w-xs truncate text-xs text-destructive">
                      {latest.stage} failed: {latest.error_message}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {new Date(doc.created_at).toLocaleString("en-US", { timeZone: "UTC" })}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
