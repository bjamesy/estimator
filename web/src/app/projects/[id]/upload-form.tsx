"use client";

import { useActionState } from "react";

import { uploadDocument } from "@/app/actions/documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function UploadForm({ projectId }: { projectId: string }) {
  const action = uploadDocument.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <Input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png" required />
      <Button type="submit" disabled={pending}>
        {pending ? "Uploading..." : "Upload"}
      </Button>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
