// Shared between the credentials server actions and client components --
// lives outside the "use server" module because those may only export
// async functions.
export const CREDENTIAL_TYPES = [
  "wsib",
  "liability_insurance",
  "business_registration",
] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];
