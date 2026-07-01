"use client";

import { useActionState } from "react";

import { createProject } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NewProjectForm() {
  const [state, formAction, pending] = useActionState(createProject, null);

  return (
    <form action={formAction} className="flex gap-2">
      <Input name="name" placeholder="New project name" required />
      <Button type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create project"}
      </Button>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
