-- auth_company_ids() is SECURITY DEFINER and was flagged by Supabase's
-- security advisor as callable by anon via PostgREST RPC. Anon calls return
-- an empty set (auth.uid() is null), so there's no data leak, but there's
-- no reason to expose it outside authenticated use either.
revoke execute on function auth_company_ids() from public;
grant execute on function auth_company_ids() to authenticated;
