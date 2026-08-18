import Link from "next/link";

import { DocumentStatusIndicator } from "@/components/document-review";
import { EmptyState } from "@/components/ui/empty-state";
import { documentFileName } from "@/lib/documents";
import { createClient } from "@/lib/supabase/server";

// Documents that arrived with no project yet -- currently only possible
// via the Twilio SMS/MMS webhook (web/src/app/api/twilio/inbound/route.ts).
// A web upload always has a project_id from the moment it's created, so
// it never appears here. Confirming a document here backfills its
// project_id (see confirmDocument), so a row disappears from this list
// the moment it's confirmed -- this view only ever shows unconfirmed
// (pending/failed/rejected) documents.
export default async function InboxPage() {
  const supabase = await createClient();

  const { data: documents } = await supabase
    .from("documents")
    .select("id, storage_path, status, created_at")
    .is("project_id", null)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Photos texted in via SMS, waiting for a project before they can be confirmed.
        </p>
      </div>

      {!documents || documents.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description="Register a phone number in Settings, then text a photo of a receipt to add it here."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {documents.map((doc) => (
            <Link
              key={doc.id}
              href={`/inbox/${doc.id}`}
              className="flex flex-col gap-1 rounded-lg border px-4 py-3 transition-colors hover:bg-muted/50"
            >
              <DocumentStatusIndicator status={doc.status} />
              <span className="truncate text-xs text-muted-foreground">
                {documentFileName(doc.storage_path)} ·{" "}
                {new Date(doc.created_at).toLocaleDateString("en-US", { timeZone: "UTC" })}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
