"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

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

export function DocumentsTable({
  projectId,
  documents: initialDocuments,
  readyForReview: initialReadyForReview,
}: {
  projectId: string;
  documents: Document[];
  readyForReview: string[];
}) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [readyForReview, setReadyForReview] = useState(new Set(initialReadyForReview));
  const [latestEvents, setLatestEvents] = useState<Record<string, LatestEvent>>({});

  // initialDocuments/initialReadyForReview are fresh every time the parent
  // Server Component re-renders (e.g. after revalidatePath on upload) --
  // useState's initializer only runs on mount, so without this the table
  // would never reflect new uploads or newly-ready documents until a full
  // page reload.
  useEffect(() => {
    setDocuments(initialDocuments);
    setReadyForReview(new Set(initialReadyForReview));
  }, [initialDocuments, initialReadyForReview]);

  useEffect(() => {
    const pendingIds = documents
      .filter((d) => d.status === "pending" && !readyForReview.has(d.id))
      .map((d) => d.id);
    if (pendingIds.length === 0) return;

    const supabase = createClient();
    let cancelled = false;

    async function poll() {
      const [{ data: docs }, { data: events }, { data: results }] = await Promise.all([
        supabase.from("documents").select("id, storage_path, status, created_at").in("id", pendingIds),
        supabase
          .from("document_processing_events")
          .select("document_id, stage, status, error_message, started_at")
          .in("document_id", pendingIds)
          .order("started_at", { ascending: false }),
        supabase.from("extraction_results").select("document_id").in("document_id", pendingIds),
      ]);

      if (cancelled) return;

      if (docs) {
        setDocuments((prev) => prev.map((d) => docs.find((updated) => updated.id === d.id) ?? d));
      }

      if (results && results.length > 0) {
        setReadyForReview((prev) => {
          const next = new Set(prev);
          for (const r of results) next.add(r.document_id);
          return next;
        });
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
    // Re-run only when the set of documents still needing polling changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    documents
      .filter((d) => d.status === "pending" && !readyForReview.has(d.id))
      .map((d) => d.id)
      .join(","),
  ]);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>File</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Uploaded</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((doc) => {
          const latest = latestEvents[doc.id];
          const isReady = readyForReview.has(doc.id);
          return (
            <TableRow key={doc.id}>
              <TableCell className="max-w-xs truncate">
                {doc.storage_path.split("/").pop()}
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <Badge variant={STATUS_VARIANT[doc.status] ?? "secondary"}>{doc.status}</Badge>
                  {doc.status === "pending" && !isReady && latest && (
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
              <TableCell>
                {doc.status === "pending" && isReady && (
                  <Link
                    href={`/projects/${projectId}/documents/${doc.id}`}
                    className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
                  >
                    Review & Confirm
                  </Link>
                )}
                {doc.status === "confirmed" && (
                  <Link
                    href={`/projects/${projectId}/documents/${doc.id}`}
                    className={cn(buttonVariants({ size: "sm", variant: "ghost" }))}
                  >
                    View
                  </Link>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
