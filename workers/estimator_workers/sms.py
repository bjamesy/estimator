"""Outbound SMS -- currently just the "that wasn't a receipt" reply sent
from tasks.py's parse task when the vision LLM rejects a document.

Thin transport layer, same shape as emails.py: Twilio's HTTP API when
TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER are set, otherwise a console
transport -- so local dev and verification work without a Twilio
account, and a provider swap touches only this module. Uses httpx
directly against Twilio's REST API rather than the Twilio Python SDK --
web/src/lib/twilio.ts already needs the real SDK for webhook signature
validation, but the worker only ever needs to POST one message, and
httpx is already a dependency here (see emails.py).
"""

import logging

import httpx

from estimator_workers.config import TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER

logger = logging.getLogger(__name__)


def send_sms(to: str, body: str) -> None:
    """Send one SMS. Raises on transport failure -- callers should treat
    this as best-effort (see tasks.py's usage) since a failed reply must
    not fail the pipeline stage that's already durably recorded its own
    outcome."""
    if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER):
        logger.info(
            "SMS (console transport -- set TWILIO_* env vars to send)\nTo: %s\n\n%s",
            to,
            body,
        )
        return

    response = httpx.post(
        f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json",
        auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
        data={"To": to, "From": TWILIO_PHONE_NUMBER, "Body": body},
        timeout=15,
    )
    response.raise_for_status()
