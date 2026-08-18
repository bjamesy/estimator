import twilioSdk from "twilio";

// Thin transport, same shape as workers/estimator_workers/emails.py --
// real API when creds are present, console fallback for local dev so
// the OTP flow is testable without a Twilio account.
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

export function isTwilioConfigured(): boolean {
  return Boolean(accountSid && authToken && fromNumber);
}

// Twilio's own validator, not hand-rolled -- getting the HMAC-SHA1/
// param-canonicalization subtly wrong would silently accept forged
// webhook requests. `url` must be the exact public URL Twilio computed
// the signature against (see buildPublicUrl in the inbound route),
// not request.url, which reflects Fly's internal proxy hop -- the same
// class of bug fixed in web/src/app/auth/callback/route.ts.
export function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!authToken) return false;
  return twilioSdk.validateRequest(authToken, signature, url, params);
}

export async function sendSms(to: string, body: string): Promise<void> {
  if (!isTwilioConfigured()) {
    console.info("SMS (console transport -- set TWILIO_* env vars to send)\nTo: %s\n\n%s", to, body);
    return;
  }
  const client = twilioSdk(accountSid, authToken);
  await client.messages.create({ to, from: fromNumber, body });
}

// Twilio media URLs require HTTP Basic Auth (Account SID : Auth Token)
// to fetch, separate from webhook signature validation.
export async function fetchTwilioMedia(mediaUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(mediaUrl, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Twilio media: ${response.status}`);
  }
  return response.arrayBuffer();
}
