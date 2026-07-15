"use client";

import { useState, useTransition } from "react";

import { importProjectIntoEstimate } from "@/app/actions/estimates";
import { Button } from "@/components/ui/button";

// Appends a project's whole purchase-history-seeded set of lines to this
// draft in one shot, instead of searching+adding one at a time -- same
// matching computation the "create estimate from project" flow uses
// (see buildProjectSeedRows in app/actions/estimates.ts), just aimed at an
// estimate that already exists. Additive only: never touches lines already
// on the draft, and the user reviews/deletes whatever they don't want
// afterward, same as at creation time.
export function ImportProjectTool({
  estimateId,
  projects,
}: {
  estimateId: string;
  projects: { id: string; name: string }[];
}) {
  const [projectId, setProjectId] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error: string | null; importedCount?: number } | null>(
    null,
  );

  if (projects.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Import from project
      </p>
      <div className="flex gap-2">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="h-8 flex-1 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">Choose a project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          disabled={!projectId || pending}
          onClick={() => {
            setResult(null);
            startTransition(async () => {
              const res = await importProjectIntoEstimate(estimateId, projectId);
              setResult(res);
              if (!res.error) setProjectId("");
            });
          }}
        >
          {pending ? "Importing…" : "Import"}
        </Button>
      </div>
      {result?.error && <p className="text-xs text-destructive">{result.error}</p>}
      {result && !result.error && (
        <p className="text-xs text-muted-foreground">
          {result.importedCount === 0
            ? "No purchase history found on that project."
            : `Added ${result.importedCount} line${result.importedCount === 1 ? "" : "s"}.`}
        </p>
      )}
    </div>
  );
}
