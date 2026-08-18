-- Adds SMS rejection-reply support and a rate limit protecting both
-- Anthropic vision-LLM cost and Twilio outbound SMS cost from abuse.

-- Which phone number a document arrived from, set only by the Twilio
-- inbound webhook -- web uploads leave this null. Needed at rejection
-- time (workers/estimator_workers/tasks.py's parse task) since a
-- company can register more than one phone number, so "the company's
-- number" is ambiguous; this records exactly which one to reply to.
alter table documents add column sms_sender_phone text;

-- Rate-limits every inbound Twilio hit (registered or not, media or
-- not) -- one row per webhook invocation, phone_number is the sender's
-- From number. No RLS policies: only the webhook (admin/service-role
-- client, no user session) ever touches this table.
create table sms_inbound_log (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null,
  created_at timestamptz not null default now()
);
create index sms_inbound_log_phone_number_created_at_idx
  on sms_inbound_log (phone_number, created_at);
alter table sms_inbound_log enable row level security;
