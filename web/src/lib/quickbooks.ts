import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Thin wrapper around the QuickBooks Online REST API -- isolates the
// third-party API shape behind one module, same precedent as
// web/src/lib/twilio.ts. Verified directly against Intuit's current
// documentation while planning this (not just training knowledge) --
// notably, refresh tokens rotate on every use as of a November 2025
// policy change, so every caller of refreshAccessToken must persist
// the newly-returned refresh_token, never reuse the old one.

const CLIENT_ID = process.env.QBO_CLIENT_ID;
const CLIENT_SECRET = process.env.QBO_CLIENT_SECRET;
const ENCRYPTION_KEY = process.env.QBO_TOKEN_ENCRYPTION_KEY;
const ENVIRONMENT = process.env.QBO_ENVIRONMENT === "production" ? "production" : "sandbox";

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const API_BASE =
  ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com/v3/company"
    : "https://sandbox-quickbooks.api.intuit.com/v3/company";

const SCOPE = "com.intuit.quickbooks.accounting";
const DEFAULT_ITEM_NAME = "Materials and Labor";

export function isQuickBooksConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET && ENCRYPTION_KEY);
}

// --- Token encryption at rest -----------------------------------------
// AES-256-GCM, application-layer (not pgcrypto -- see
// database/migrations/0025_quickbooks_integration.sql for why). Stored
// as base64(iv [12B] + authTag [16B] + ciphertext).

function encryptionKeyBuffer(): Buffer {
  if (!ENCRYPTION_KEY) throw new Error("QBO_TOKEN_ENCRYPTION_KEY is not set");
  // Accepts either a 32-byte hex string or any string, hashed down to
  // 32 bytes -- simplest to generate (`openssl rand -hex 32`) without
  // requiring an exact-length secret.
  return ENCRYPTION_KEY.length === 64 && /^[0-9a-f]+$/i.test(ENCRYPTION_KEY)
    ? Buffer.from(ENCRYPTION_KEY, "hex")
    : Buffer.from(ENCRYPTION_KEY.padEnd(32, "0").slice(0, 32));
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKeyBuffer(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptToken(encrypted: string): string {
  const raw = Buffer.from(encrypted, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKeyBuffer(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// --- OAuth ---------------------------------------------------------

export function buildRedirectUri(host: string, proto: string): string {
  return `${proto}://${host}/api/quickbooks/callback`;
}

export function buildAuthorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export type TokenResponse = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
};

function basicAuthHeader(): string {
  return `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`;
}

async function requestTokens(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error(`QuickBooks token request failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  const now = Date.now();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessTokenExpiresAt: new Date(now + data.expires_in * 1000),
    refreshTokenExpiresAt: new Date(now + data.x_refresh_token_expires_in * 1000),
  };
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  return requestTokens(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  );
}

// Every call rotates the refresh token -- the caller MUST persist the
// returned refreshToken immediately, or the next refresh attempt will
// fail with invalid_grant (see module comment above).
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return requestTokens(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }));
}

// --- Accounting API --------------------------------------------------

// QBO's query language is SQL-like; a name containing a single quote
// needs escaping the same way user text going into any query string
// does (see escapeLikePattern in web/src/app/actions/confirm.ts for the
// equivalent Postgres ILIKE case -- different escaping rules, same
// reason).
function escapeQboQueryValue(value: string): string {
  return value.replace(/'/g, "''");
}

async function qboFetch<T>(
  accessToken: string,
  realmId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE}/${realmId}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`QuickBooks API request failed: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

type QboQueryResponse<K extends string, V> = { QueryResponse?: Record<K, V[]> };

export async function findOrCreateCustomer(
  accessToken: string,
  realmId: string,
  displayName: string,
): Promise<string> {
  const query = `select * from Customer where DisplayName = '${escapeQboQueryValue(displayName)}'`;
  const found = await qboFetch<QboQueryResponse<"Customer", { Id: string }>>(
    accessToken,
    realmId,
    `query?query=${encodeURIComponent(query)}`,
  );
  const existing = found?.QueryResponse?.Customer?.[0];
  if (existing) return existing.Id;

  const created = await qboFetch<{ Customer: { Id: string } }>(accessToken, realmId, "customer", {
    method: "POST",
    body: JSON.stringify({ DisplayName: displayName }),
  });
  return created.Customer.Id;
}

// v1 simplification: one shared generic Item for every invoice line
// rather than a full material-to-QBO-item mapping system -- see the
// plan's Design #4. Every line's real description still shows via its
// own Description field regardless of which Item it references.
export async function findOrCreateDefaultItem(
  accessToken: string,
  realmId: string,
): Promise<string> {
  const itemQuery = `select * from Item where Name = '${escapeQboQueryValue(DEFAULT_ITEM_NAME)}'`;
  const found = await qboFetch<QboQueryResponse<"Item", { Id: string }>>(
    accessToken,
    realmId,
    `query?query=${encodeURIComponent(itemQuery)}`,
  );
  const existing = found?.QueryResponse?.Item?.[0];
  if (existing) return existing.Id;

  // Creating a Service item requires a valid IncomeAccountRef -- every
  // QBO company file has at least one Income account in its default
  // chart of accounts, so the first one found is a safe pick for a v1
  // catch-all item (a contractor can re-categorize it in QBO directly
  // if they want a specific account instead).
  const accountQuery = "select * from Account where AccountType = 'Income'";
  const accounts = await qboFetch<QboQueryResponse<"Account", { Id: string }>>(
    accessToken,
    realmId,
    `query?query=${encodeURIComponent(accountQuery)}`,
  );
  const incomeAccount = accounts?.QueryResponse?.Account?.[0];
  if (!incomeAccount) {
    throw new Error("No Income account found in this QuickBooks company to attach the default item to.");
  }

  const created = await qboFetch<{ Item: { Id: string } }>(accessToken, realmId, "item", {
    method: "POST",
    body: JSON.stringify({
      Name: DEFAULT_ITEM_NAME,
      Type: "Service",
      IncomeAccountRef: { value: incomeAccount.Id },
    }),
  });
  return created.Item.Id;
}

export type InvoiceLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export async function createInvoice(
  accessToken: string,
  realmId: string,
  customerId: string,
  itemId: string,
  lines: InvoiceLine[],
): Promise<string> {
  const created = await qboFetch<{ Invoice: { Id: string } }>(accessToken, realmId, "invoice", {
    method: "POST",
    body: JSON.stringify({
      CustomerRef: { value: customerId },
      Line: lines.map((line) => ({
        Amount: line.amount,
        DetailType: "SalesItemLineDetail",
        Description: line.description,
        SalesItemLineDetail: {
          ItemRef: { value: itemId },
          Qty: line.quantity,
          UnitPrice: line.unitPrice,
        },
      })),
    }),
  });
  return created.Invoice.Id;
}
