import os

from dotenv import load_dotenv

load_dotenv()

RABBITMQ_URL = os.environ["RABBITMQ_URL"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
