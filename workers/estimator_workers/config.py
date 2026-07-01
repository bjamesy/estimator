import os

from dotenv import load_dotenv

load_dotenv()

BROKER_URL = os.environ["MESSAGE_BROKER_URL"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
