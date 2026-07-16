import { createHash, randomBytes } from "crypto";

// In-house signature capture, v1. This module is the seam a certified
// e-signature provider (DocuSign-class) would replace -- the lifecycle
// state machine in the actions doesn't know how a signature is captured
// or how a client link is authorized, only that these helpers exist.
// See docs/v2/plans/01-change-orders-plan.md -> Phase 3.

// How long a client signing link stays valid. Long enough that a
// homeowner sitting on it over a long weekend isn't locked out; short
// enough that a stale link in an inbox eventually dies. The contractor
// can mint a fresh link at any time while the version is pending.
export const SIGNING_TOKEN_TTL_DAYS = 30;

// The consent statement shown beside every signature checkbox lives in
// lib/change-order-copy.ts (this module is server-only via node:crypto;
// the copy renders in client components).

// 256-bit random token, base64url (URL-safe, no padding). The raw token
// exists only in the signing URL; the database stores its hash.
export function generateSigningToken(): string {
  return randomBytes(32).toString("base64url");
}

// SHA-256 hex. Tokens have full 256-bit entropy, so a plain unsalted
// hash is sufficient -- this isn't password hashing, there's nothing to
// dictionary-attack.
export function hashSigningToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function signingTokenExpiry(): Date {
  return new Date(Date.now() + SIGNING_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
