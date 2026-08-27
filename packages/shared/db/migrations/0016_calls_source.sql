-- Calendar auto-join provenance. Manual creation remains the default so all
-- existing callers and rows retain their current semantics.
ALTER TABLE calls
  ADD COLUMN source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'calendar')),
  ADD COLUMN source_event_id text;

-- A provider event may create at most one call per tenant/source. NULL manual
-- identities remain unrestricted.
CREATE UNIQUE INDEX calls_tenant_source_event_unique_idx
  ON calls (tenant_id, source, source_event_id)
  WHERE source_event_id IS NOT NULL;
