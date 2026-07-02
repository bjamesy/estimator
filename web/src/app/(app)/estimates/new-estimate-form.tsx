"use client";

import { useActionState } from "react";

import { createEstimate } from "@/app/actions/estimates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Project = { id: string; name: string };

// Only used by the top-level /estimates page -- a project's own page
// offers createEstimateFromProject instead, which is strictly more
// useful there than an empty estimate.
export function NewEstimateForm({ projects }: { projects: Project[] }) {
  const [state, formAction, pending] = useActionState(createEstimate, null);

  return (
    <form action={formAction} className="flex gap-2">
      <Input name="name" placeholder="New estimate name" required />
      <select
        name="project_id"
        defaultValue=""
        className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      >
        <option value="">No project</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create estimate"}
      </Button>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
