// Shared between web/src/app/actions/documents.ts (web upload, "use
// server") and web/src/app/api/twilio/inbound/route.ts (MMS upload) --
// the same file-type rules and content hash apply to a document
// regardless of which channel it arrived through. Kept out of
// documents.ts because "use server" files may only export async
// functions (see that file's own history) -- these plain constants
// can't live there.

export const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
];
export const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif"];

export const POSTGRES_UNIQUE_VIOLATION = "23505";

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}
