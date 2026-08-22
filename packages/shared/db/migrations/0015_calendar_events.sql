-- 0015_calendar_events — normalized Google Calendar event cache (issue #240).
--
-- Event rows are tenant product data, unlike the privileged credentials in
-- 0014. Runtime access is therefore protected by enabled + forced RLS using
-- the scalar sub-SELECT tenant policy established by 0010_settings.

CREATE TABLE calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  provider_event_id text NOT NULL,
  recurring_event_id text,
  title text NOT NULL DEFAULT '',
  organizer_email text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  attendee_response text CHECK (attendee_response IS NULL OR attendee_response IN ('needsAction','declined','tentative','accepted')),
  meeting_url text,
  meeting_provider text CHECK (meeting_provider IS NULL OR meeting_provider IN ('google_meet','zoom')),
  source_updated_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_events_connection_fk FOREIGN KEY (connection_id, tenant_id) REFERENCES calendar_connections(id, tenant_id) ON DELETE CASCADE,
  UNIQUE (connection_id, provider_event_id),
  CHECK (ends_at >= starts_at)
);
CREATE INDEX calendar_events_upcoming_idx ON calendar_events (tenant_id, starts_at, id);
CREATE INDEX calendar_events_connection_sync_idx ON calendar_events (connection_id, synced_at);
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events FORCE ROW LEVEL SECURITY;
CREATE POLICY calendar_events_tenant_isolation ON calendar_events FOR ALL TO samograph_app
  USING (tenant_id = (SELECT current_setting('app.tenant_id'))::uuid)
  WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id'))::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_events TO samograph_app;
