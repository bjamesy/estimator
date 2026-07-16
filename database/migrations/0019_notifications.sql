-- Notification support for the change-order signing flow. See
-- docs/v2/plans/01-change-orders-plan.md -> Phase 5.
--
-- client_email: who the signing link was sent to (nullable -- the
-- contractor can still hand the link over themselves without email).
-- Written at mint time by the authed insert; carried forward when the
-- reminder sweep replaces a token.
--
-- reminder_sent_at: non-null marks a token minted BY the reminder sweep
-- (raw tokens are never stored, so a reminder can't resend the original
-- link -- it revokes the old token and mints a fresh one; see
-- send_signing_reminders in workers/estimator_workers/tasks.py). The
-- sweep only considers tokens where this is null, so each signing chain
-- gets at most one reminder. Written only by the worker (service role);
-- authenticated sessions still have no update policy on this table.
alter table client_signing_tokens add column client_email text;
alter table client_signing_tokens add column reminder_sent_at timestamptz;
