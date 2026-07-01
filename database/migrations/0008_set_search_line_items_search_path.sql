-- Fixes a Supabase security advisor warning (mutable search_path) flagged
-- right after 0007 was applied. Same fix pattern already used for
-- auth_company_ids() in 0002.
alter function search_line_items(text) set search_path = public;
