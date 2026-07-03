"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { retryDocumentProcessing } from "@/app/actions/documents";
import { Button, buttonVariants } from "@/components/ui/button";
import { documentFileName } from "@/lib/documents";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Document = {
  id: string;
  storage_path: string;
  status: string;
  created_at: string;
  rejection_reason: string | null;
};

type LatestEvent = {
  stage: string;
  status: "started" | "succeeded" | "failed";
  error_message: string | null;
  started_at: string;
} | null;

// Subtle dot + label per status instead of a loud filled badge. Conventional
// status colors (green ok / red error / amber in-progress / grey neutral);
// "ready to review" borrows the brand to nudge toward the action.
function statusMeta(
  status: string,
  isReady: boolean,
  isStalled: boolean,
): { dotClass: string; label: string } {
  if (status === "pending") {
    if (isStalled) return { dotClass: "bg-amber-500", label: "Stalled" };
    if (isReady) return { dotClass: "bg-primary", label: "Ready to review" };
    return { dotClass: "bg-amber-500 animate-pulse", label: "Processing" };
  }
  if (status === "confirmed") return { dotClass: "bg-emerald-500", label: "Confirmed" };
  if (status === "failed") return { dotClass: "bg-destructive", label: "Failed" };
  if (status === "rejected") {
    return { dotClass: "bg-muted-foreground", label: "Not a purchase document" };
  }
  return { dotClass: "bg-muted-foreground", label: status };
}

const POLL_INTERVAL_MS = 2000;

// Keep in sync with STALL_THRESHOLD_MS in app/actions/documents.ts (the
// action re-checks server-side). A pending document with no pipeline
// activity for this long has almost certainly lost its task (broker
// wiped mid-chain, worker down, publish failure) -- the pipeline's worst
// legitimate quiet stretch is the 10/20/30s retry backoffs, minutes
// shorter than this.
const STALL_THRESHOLD_MS = 5 * 60 * 1000;

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
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});
  // Clock for staleness checks, advanced by the poll loop below rather
  // than calling Date.now() during render (render must stay pure). 0
  // means "no poll tick yet" -- nothing shows as stalled until the
  // first tick lands (~immediately after mount while pending docs
  // exist, which is the only time stalledness matters).
  const [now, setNow] = useState(0);

  async function handleRetry(documentId: string) {
    setRetryingId(documentId);
    setRetryErrors((prev) => ({ ...prev, [documentId]: "" }));
    const { error } = await retryDocumentProcessing(documentId);
    if (error) {
      setRetryErrors((prev) => ({ ...prev, [documentId]: error }));
    }
    setRetryingId(null);
  }

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
      setNow(Date.now());
      const [{ data: docs }, { data: events }, { data: results }] = await Promise.all([
        supabase
          .from("documents")
          .select("id, storage_path, status, created_at, rejection_reason")
          .in("id", pendingIds),
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
                started_at: latest.started_at,
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
    <div className="flex flex-col gap-2">
      {documents.map((doc) => {
        const latest = latestEvents[doc.id];
        const isReady = readyForReview.has(doc.id);
        // No pipeline activity past the threshold means the task was lost
        // (broker wiped mid-chain, worker down at publish time) -- the chain
        // never resumes on its own, so waiting longer won't help. Falls back
        // to created_at for documents whose task was lost before any event
        // was ever written.
        const lastActivity = new Date(latest?.started_at ?? doc.created_at).getTime();
        const isStalled =
          doc.status === "pending" && !isReady && now > 0 && now - lastActivity > STALL_THRESHOLD_MS;
        const { dotClass, label } = statusMeta(doc.status, isReady, isStalled);

        return (
          <div
            key={doc.id}
            className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className={cn("size-2 shrink-0 rounded-full", dotClass)} />
                <span className="text-sm font-medium">{label}</span>
              </div>
              <span className="truncate text-xs text-muted-foreground">
                {documentFileName(doc.storage_path)} ·{" "}
                {new Date(doc.created_at).toLocaleDateString("en-US", { timeZone: "UTC" })}
              </span>
              {isStalled && (
                <span className="text-xs text-destructive">The task appears to have been lost.</span>
              )}
              {retryErrors[doc.id] && (
                <span className="truncate text-xs text-destructive">{retryErrors[doc.id]}</span>
              )}
              {doc.status === "failed" && latest?.error_message && (
                <span className="truncate text-xs text-destructive">
                  {latest.stage} failed: {latest.error_message}
                </span>
              )}
              {doc.status === "rejected" && doc.rejection_reason && (
                <span className="truncate text-xs text-muted-foreground">
                  {doc.rejection_reason}
                </span>
              )}
            </div>

            <div className="shrink-0">
              {doc.status === "pending" && isReady && (
                <Link
                  href={`/projects/${projectId}/documents/${doc.id}`}
                  className={cn(buttonVariants({ size: "sm" }))}
                >
                  Review
                </Link>
              )}
              {isStalled && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={retryingId === doc.id}
                  onClick={() => handleRetry(doc.id)}
                >
                  {retryingId === doc.id ? "Retrying..." : "Retry"}
                </Button>
              )}
              {doc.status === "confirmed" && (
                <Link
                  href={`/projects/${projectId}/documents/${doc.id}`}
                  className={cn(buttonVariants({ size: "sm", variant: "ghost" }))}
                >
                  View
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
