"use client";

import { useActionState } from "react";

import { createEstimate } from "@/app/actions/estimates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NewEstimateForm({ projectId }: { projectId: string }) {
  const action = createEstimate.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="flex gap-2">
      <Input name="name" placeholder="New estimate name" required />
      <Button type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create estimate"}
      </Button>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
