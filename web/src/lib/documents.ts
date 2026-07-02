// Storage paths are `${companyId}/${projectId}/${randomUUID()}-${safeName}`
// (see uploadDocument in app/actions/documents.ts) -- the UUID prefix
// exists only to keep storage keys unique and is noise in the UI. This
// recovers the user's original (sanitized) file name for display.
export function documentFileName(storagePath: string): string {
  const name = storagePath.split("/").pop() ?? storagePath;
  return name.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
    "",
  );
}
