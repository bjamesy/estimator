"""Transactional email for change-order notifications.

Thin transport layer: Resend's HTTP API when RESEND_API_KEY is set,
otherwise a console transport that logs the full message -- so local dev
and verification work without an email account, and a provider swap
touches only this module. See docs/v2/plans/01-change-orders-plan.md ->
Phase 5 (this same module is what feature 02's credential expiry
reminders will reuse).
"""

import logging

import httpx

from estimator_workers.config import EMAIL_FROM, RESEND_API_KEY

logger = logging.getLogger(__name__)

RESEND_ENDPOINT = "https://api.resend.com/emails"


def send_email(to: str, subject: str, text: str) -> None:
    """Send one email. Raises on transport failure so calling tasks can
    retry; the console transport never fails."""
    if not RESEND_API_KEY:
        logger.info(
            "EMAIL (console transport -- set RESEND_API_KEY to send)\n"
            "To: %s\nFrom: %s\nSubject: %s\n\n%s",
            to,
            EMAIL_FROM,
            subject,
            text,
        )
        return

    response = httpx.post(
        RESEND_ENDPOINT,
        headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
        json={"from": EMAIL_FROM, "to": [to], "subject": subject, "text": text},
        timeout=15,
    )
    response.raise_for_status()
