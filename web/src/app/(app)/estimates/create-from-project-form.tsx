"use client";

import { useActionState } from "react";

import { createEstimateFromProject } from "@/app/actions/estimates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateFromProjectForm({ projectId }: { projectId: string }) {
  const action = createEstimateFromProject.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="flex gap-2">
      <Input name="name" placeholder="Estimate name" required />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Building..." : "Create estimate from this project's materials"}
      </Button>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
