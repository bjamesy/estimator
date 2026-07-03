"use client";

import { useActionState } from "react";

import { createEstimate } from "@/app/actions/estimates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Project = { id: string; name: string };

// The /estimates create form. Choosing a project seeds the estimate from
// that project's purchase history (createEstimate delegates to the seeding
// path); "No project" starts a blank, company-wide estimate.
export function NewEstimateForm({ projects }: { projects: Project[] }) {
  const [state, formAction, pending] = useActionState(createEstimate, null);

  return (
    <div className="flex flex-col gap-1.5">
      <form action={formAction} className="flex gap-2">
        <Input name="name" placeholder="New estimate name" required />
        <select
          name="project_id"
          defaultValue=""
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <option value="">No project — blank estimate</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              Seed from: {p.name}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating..." : "Create estimate"}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Pick a project to seed lines from its purchase history, or leave blank to build one from
        scratch.
      </p>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </div>
  );
}
