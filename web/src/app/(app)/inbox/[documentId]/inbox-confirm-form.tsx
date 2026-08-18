"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { confirmDocument } from "@/app/actions/confirm";
import { Button } from "@/components/ui/button";

export function InboxConfirmForm({
  documentId,
  projects,
}: {
  documentId: string;
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmDocument(documentId, projectId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(`/projects/${projectId}`);
    });
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <select
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-auto dark:bg-input/30"
      >
        <option value="">Choose a project…</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <Button type="button" disabled={pending || projectId === ""} onClick={handleConfirm}>
        {pending ? "Confirming..." : "Confirm"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
