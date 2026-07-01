from supabase import Client, create_client

from estimator_workers.config import SUPABASE_SECRET_KEY, SUPABASE_URL

_client: Client | None = None


def get_supabase() -> Client:
    # SUPABASE_SECRET_KEY bypasses RLS by design -- the worker always writes
    # as a privileged service. See docs/architecture.md -> Company Scoping.
    global _client
    if _client is None:
        _client = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
    return _client
