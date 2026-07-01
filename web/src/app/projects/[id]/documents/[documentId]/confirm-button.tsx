"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";

import { confirmDocument } from "@/app/actions/confirm";
import { Button } from "@/components/ui/button";

export function ConfirmButton({ documentId, projectId }: { documentId: string; projectId: string }) {
  const router = useRouter();

  const [state, formAction, pending] = useActionState(
    async (_prevState: { error: string | null } | null) => {
      const result = await confirmDocument(documentId);
      if (!result.error) {
        router.push(`/projects/${projectId}`);
      }
      return result;
    },
    null,
  );

  return (
    <form action={formAction}>
      <Button type="submit" disabled={pending}>
        {pending ? "Confirming..." : "Confirm"}
      </Button>
      {state?.error && <p className="mt-2 text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
