ALTER TABLE calendar_events
  ADD COLUMN auto_join_excluded boolean NOT NULL DEFAULT false;
