"use client";

import { useActionState, useRef } from "react";

import { uploadDocument } from "@/app/actions/documents";
import { Button } from "@/components/ui/button";

// Extensions AND MIME types -- file pickers across OSes match
// inconsistently on one or the other (notably HEIC, which many
// non-Safari browsers don't recognize by MIME type).
const FILE_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif,application/pdf";

export function UploadForm({ projectId }: { projectId: string }) {
  const action = uploadDocument.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Both buttons share one hidden input (two inputs would both be
  // name="file" and collide in FormData) and configure it imperatively
  // right before opening the dialog. React would restore the
  // JSX-declared attributes on a re-render, which is fine -- they're
  // always re-set here before each click, and the dialog opens
  // synchronously.
  function openCamera() {
    const input = inputRef.current;
    if (!input) return;
    // capture="environment" opens the rear camera directly on mobile
    // browsers; it's a hint, so a device without a camera just falls
    // back to its normal picker.
    input.setAttribute("capture", "environment");
    input.setAttribute("accept", "image/*");
    input.click();
  }

  function openFilePicker() {
    const input = inputRef.current;
    if (!input) return;
    input.removeAttribute("capture");
    input.setAttribute("accept", FILE_ACCEPT);
    input.click();
  }

  // Auto-upload: submission starts the moment a file is selected/shot,
  // no separate Upload tap (same requestSubmit-via-ref pattern as the
  // autosave in estimates/[estimateId]/estimate-line-row.tsx). The
  // value reset lets re-selecting the same file (e.g. after a failed
  // upload) fire change again.
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      formRef.current?.requestSubmit();
      e.target.value = "";
    }
  }

  return (
    <form ref={formRef} action={formAction} className="flex items-center gap-2">
      <input
        ref={inputRef}
        name="file"
        type="file"
        accept={FILE_ACCEPT}
        onChange={handleChange}
        className="hidden"
      />
      <Button
        type="button"
        disabled={pending}
        onClick={openCamera}
        className="hidden pointer-coarse:inline-flex"
      >
        {pending ? "Uploading..." : "Take photo"}
      </Button>
      <Button type="button" variant="outline" disabled={pending} onClick={openFilePicker}>
        {pending ? "Uploading..." : "Choose file"}
      </Button>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
