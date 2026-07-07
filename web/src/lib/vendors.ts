// Supported vendor hosts for price spot-checks. Keep in sync with
// workers/estimator_workers/vendor_price.py (the worker re-validates at
// fetch time -- this list is the SSRF guard on both sides; arbitrary
// URLs are never fetched). See docs/v2/plans/05-vendor-price-check-plan.md.
export const ALLOWED_VENDOR_HOSTS = [
  "homedepot.ca",
  "www.homedepot.ca",
  "rona.ca",
  "www.rona.ca",
  "homehardware.ca",
  "www.homehardware.ca",
];

// Dev/verification escape hatch, mirroring the worker's
// VENDOR_PRICE_TEST_HOST. Never set in production.
const testHost = process.env.VENDOR_PRICE_TEST_HOST;

export function validateVendorUrl(raw: string): { error: string | null } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: "That doesn't look like a valid URL." };
  }
  const hostAllowed = ALLOWED_VENDOR_HOSTS.includes(url.hostname) || url.hostname === testHost;
  if (!hostAllowed) {
    return {
      error: `Unsupported vendor. Supported: ${["homedepot.ca", "rona.ca", "homehardware.ca"].join(", ")}.`,
    };
  }
  const schemeOk = url.protocol === "https:" || (url.hostname === testHost && url.protocol === "http:");
  if (!schemeOk) {
    return { error: "Use an https product page URL." };
  }
  return { error: null };
}
