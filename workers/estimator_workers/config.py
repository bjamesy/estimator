import os

from dotenv import load_dotenv

load_dotenv()

BROKER_URL = os.environ["MESSAGE_BROKER_URL"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]

# Not required until Phase 2 (vision LLM extraction).
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
