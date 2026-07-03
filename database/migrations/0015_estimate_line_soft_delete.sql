-- Removing an estimate line tombstones it instead of hard-deleting. The
-- line is retained with deleted_at set, excluded from the estimate total
-- and any export (both count only rows where deleted_at is null), and
-- restorable by clearing deleted_at. This lets a user undo an accidental
-- removal and keeps a record of what was considered and dropped.
--
-- Nullable with no default: existing rows and every newly-inserted line
-- are null = active. A non-null timestamp is the tombstone.
alter table estimate_lines add column deleted_at timestamptz;
