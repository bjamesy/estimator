import os

from dotenv import load_dotenv

load_dotenv()

BROKER_URL = os.environ["MESSAGE_BROKER_URL"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]

# Email (change-order notifications -- docs/v2/plans/01-change-orders-plan.md
# -> Phase 5). Optional: without RESEND_API_KEY the email module logs
# messages instead of sending (console transport), so local dev and the
# rest of the pipeline work without an email account.
RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
EMAIL_FROM = os.environ.get("EMAIL_FROM", "Estimator <onboarding@resend.dev>")
# Base URL used when the worker itself has to build a signing link (the
# reminder sweep mints fresh tokens; web-published emails carry a URL
# built from the request's own host instead).
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:3000")
