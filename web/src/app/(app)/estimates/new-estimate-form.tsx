"use client";

import { useActionState } from "react";

import { createEstimate } from "@/app/actions/estimates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Project = { id: string; name: string };

// projectId is pre-bound when rendered on a project's own page (no
// picker needed -- the project is already implied). Otherwise pass
// `projects` and this renders a picker so the top-level /estimates page
// can optionally link a new estimate to one.
export function NewEstimateForm({
  projectId,
  projects,
}: {
  projectId?: string;
  projects?: Project[];
}) {
  const action = createEstimate.bind(null, projectId ?? null);
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="flex gap-2">
      <Input name="name" placeholder="New estimate name" required />
      {!projectId && projects && (
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
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create estimate"}
      </Button>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
